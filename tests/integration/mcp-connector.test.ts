import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";

/*
 * End-to-end OAuth 2.1 + MCP flow as ChatGPT/Claude drive it, against the
 * disposable test database: dynamic client registration, authorize, sign-in
 * continuation through the guarded email-code route, consent, PKCE token
 * exchange, then MCP calls with the issued access token. Only next/headers is
 * stubbed (the routes run outside a Next request scope) and Google link
 * resolution is faked so no provider is called.
 */
vi.hoisted(() => {
  process.env.FEATURE_MCP_CONNECTOR = "true";
  process.env.FEATURE_LAYER_WRITES = "true";
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    has: () => false,
  }),
}));
const fakeGoogle = vi.hoisted(() => ({
  resolve: vi.fn(),
  importPlaces: vi.fn(),
}));
vi.mock("../../apps/web/src/features/google-links/service", () => ({
  resolveGoogleLinks: fakeGoogle.resolve,
  importGooglePlaces: fakeGoogle.importPlaces,
  createLayerFromGoogle: vi.fn(),
}));

import { pool } from "../../packages/database/src";
import {
  POST as authPost,
  GET as authGet,
} from "../../apps/web/src/app/api/auth/[...all]/route";
import { POST as mcpPost } from "../../apps/web/src/app/api/mcp/route";
import { GET as resourceMetadata } from "../../apps/web/src/app/.well-known/oauth-protected-resource/api/mcp/route";
import { GET as serverMetadata } from "../../apps/web/src/app/.well-known/oauth-authorization-server/api/auth/route";
import { mcpIssuer, mcpResource } from "../../apps/web/src/features/mcp/config";
import { localTestMailer } from "../../packages/shared/src/mail";
import { resetCodeSendLimits } from "../../apps/web/src/features/membership/rate-limit";

const origin = new URL(mcpResource).origin;
const redirectUri = "https://claude.ai/api/mcp/auth_callback";
const emails: string[] = [];
const clientIds: string[] = [];
let userId: string;
let email: string;
let layerId: string;

const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

function authJson(path: string, body: unknown, cookie = "") {
  return authPost(
    new NextRequest(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": randomIp(),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

async function register() {
  const response = await authJson("/oauth2/register", {
    client_name: "Test MCP client",
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
  expect(response.status).toBeLessThan(300);
  const body = (await response.json()) as { client_id: string };
  clientIds.push(body.client_id);
  return body.client_id;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Signed query from a redirect Location (to /sign-in or /oauth/consent). */
function signedQuery(location: string) {
  return new URL(location, origin).search.slice(1);
}

async function signInCode(address: string) {
  await resetCodeSendLimits(address);
  localTestMailer.sent.length = 0;
  const sent = await authJson("/email-otp/send-verification-otp", {
    email: address,
    type: "sign-in",
  });
  expect(sent.status).toBe(200);
  const mail = localTestMailer.sent.find((m) => m.to === address);
  return mail!.text.match(/\d{6}/)![0];
}

/** Runs the whole browser leg and returns tokens for the requested scopes. */
async function connect(scope: string) {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const authorize = new URL(`${origin}/api/auth/oauth2/authorize`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state: "state-123",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: mcpResource,
  }))
    authorize.searchParams.set(k, v);
  // Signed out: the provider sends the member to our sign-in page.
  const toLogin = await authGet(
    new NextRequest(authorize, { headers: { "x-forwarded-for": randomIp() } }),
  );
  const loginLocation = toLogin.headers.get("location") ?? "";
  expect(loginLocation).toContain("/sign-in?");
  // The sign-in form forwards the signed query with the code; the response
  // continues authorization, here to the consent screen.
  const code = await signInCode(email);
  const signedIn = await authJson("/sign-in/email-otp", {
    email,
    otp: code,
    oauth_query: signedQuery(loginLocation),
  });
  expect(signedIn.status).toBe(200);
  const cookie = cookieOf(signedIn);
  const next = (await signedIn.json()) as { redirect?: boolean; url?: string };
  expect(next.redirect).toBe(true);
  expect(next.url).toContain("/oauth/consent?");
  const consent = await authJson(
    "/oauth2/consent",
    { accept: true, oauth_query: signedQuery(next.url!) },
    cookie,
  );
  expect(consent.status).toBe(200);
  const { url } = (await consent.json()) as { url: string };
  const callback = new URL(url);
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe("state-123");
  const token = await authPost(
    new NextRequest(`${origin}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": randomIp(),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code")!,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource: mcpResource,
      }).toString(),
    }),
  );
  expect(token.status).toBe(200);
  return (await token.json()) as {
    access_token: string;
    refresh_token?: string;
    scope: string;
  };
}

let rpcId = 0;
async function mcp(accessToken: string | null, method: string, params = {}) {
  const response = await mcpPost(
    new Request(`${origin}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
  );
  return response;
}
async function callTool(token: string, name: string, args: unknown) {
  const response = await mcp(token, "tools/call", { name, arguments: args });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  const text = body.result.content[0].text;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // The SDK reports schema validation failures as plain text.
    data = { message: text };
  }
  return { isError: !!body.result.isError, data };
}

beforeAll(async () => {
  email = `mcp-${crypto.randomUUID()}@mcp-connector-test.example`;
  emails.push(email);
  userId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
    [userId, "MCP Test", email, "USER"],
  );
  await pool.query(
    `INSERT INTO membership_admission(user_id, source) VALUES ($1, 'legacy')`,
    [userId],
  );
  const city = await pool.query<{ id: string }>(
    "SELECT id FROM city WHERE slug='houston'",
  );
  layerId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO layer(id,slug,title,city_id,owner_kind,owner_user_id,audience,schedule,lifecycle,created_by,updated_by)
     VALUES($1,$2,'MCP test layer',$3,'user',$4,'private','evergreen','active',$4,$4)`,
    [layerId, `mcp-test-${layerId.slice(0, 8)}`, city.rows[0].id, userId],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM layer WHERE id=$1", [layerId]);
  await pool.query("DELETE FROM oauth_client WHERE client_id = ANY($1)", [
    clientIds,
  ]);
  await pool.query("DELETE FROM analytics_event WHERE user_id=$1", [userId]);
  await pool.query("DELETE FROM membership_admission WHERE user_id=$1", [
    userId,
  ]);
  await pool.query("DELETE FROM verification WHERE identifier = ANY($1)", [
    emails.map((e) => `sign-in-otp-${e}`),
  ]);
  await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await pool.end();
});

describe("discovery", () => {
  it("publishes protected resource and authorization server metadata", async () => {
    const resource = (await (await resourceMetadata()).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(mcpResource);
    expect(resource.authorization_servers).toEqual([mcpIssuer]);
    const server = (await (
      await serverMetadata(
        new Request(
          `${origin}/.well-known/oauth-authorization-server/api/auth`,
        ),
      )
    ).json()) as Record<string, unknown>;
    expect(server.issuer).toBe(mcpIssuer);
    expect(server.registration_endpoint).toBe(`${mcpIssuer}/oauth2/register`);
    expect(server.code_challenge_methods_supported).toContain("S256");
  });

  it("challenges unauthenticated MCP requests toward the metadata", async () => {
    const response = await mcp(null, "tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    const forged = await mcp("not.a.jwt", "tools/list");
    expect(forged.status).toBe(401);
  });
});

describe("connected member", () => {
  let fullToken: string;

  it("completes OAuth and lists only tools the scopes allow", async () => {
    const full = await connect("layers:read layers:write offline_access");
    fullToken = full.access_token;
    expect(full.refresh_token).toBeTruthy();
    const listed = await mcp(fullToken, "tools/list");
    const names = (
      (await listed.json()) as { result: { tools: { name: string }[] } }
    ).result.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_layers",
        "get_layer_places",
        "add_places_to_layer",
        "remove_place_from_layer",
      ]),
    );

    const readOnly = await connect("layers:read");
    const readNames = (
      (await (await mcp(readOnly.access_token, "tools/list")).json()) as {
        result: { tools: { name: string }[] };
      }
    ).result.tools.map((t) => t.name);
    expect(readNames).toEqual(["list_layers", "get_layer_places"]);
    // A tool outside the token's scopes is not callable either.
    const denied = await mcp(readOnly.access_token, "tools/call", {
      name: "add_places_to_layer",
      arguments: { layer: layerId, links: ["https://maps.app.goo.gl/x"] },
    });
    const deniedBody = (await denied.json()) as {
      error?: unknown;
      result?: { isError?: boolean };
    };
    expect(deniedBody.error ?? deniedBody.result?.isError).toBeTruthy();
  });

  it("acts as the member through the existing services", async () => {
    const listed = await callTool(fullToken, "list_layers", { scope: "mine" });
    expect(listed.isError).toBe(false);
    const layers = listed.data.layers as { id: string; canEdit: boolean }[];
    expect(layers.find((l) => l.id === layerId)?.canEdit).toBe(true);

    const places = await callTool(fullToken, "get_layer_places", {
      layer: layerId,
    });
    expect(places.isError).toBe(false);
    expect((places.data.layer as { id: string }).id).toBe(layerId);

    fakeGoogle.resolve.mockResolvedValueOnce({
      results: [
        {
          input: "https://maps.app.goo.gl/a",
          status: "resolved",
          providerPlaceId: "ChIJ-test-place",
          name: "Test Bakery",
        },
        {
          input: "https://www.instagram.com/p/abc/",
          status: "resolved",
          source: "instagram",
          name: "Caption Cafe",
        },
      ],
    });
    fakeGoogle.importPlaces.mockResolvedValueOnce({ added: 1, skipped: [] });
    const added = await callTool(fullToken, "add_places_to_layer", {
      layer: layerId,
      links: ["https://maps.app.goo.gl/a", "https://www.instagram.com/p/abc/"],
    });
    expect(added.isError).toBe(false);
    expect(added.data.added).toBe(1);
    // Only the Google Maps result is imported; the Instagram caption is reported.
    expect(fakeGoogle.importPlaces).toHaveBeenCalledWith(
      { id: userId, role: "USER" },
      layerId,
      {
        providerPlaceIds: ["ChIJ-test-place"],
        linkNames: { "ChIJ-test-place": "Test Bakery" },
      },
    );
    expect(added.data.unresolved).toEqual([
      expect.objectContaining({ reason: "instagram_not_added" }),
    ]);
  });

  it("rejects invalid input and other members' layers without leaking", async () => {
    const bad = await callTool(fullToken, "get_layer_places", { layer: "" });
    expect(bad.isError).toBe(true);
    const missing = await callTool(fullToken, "get_layer_places", {
      layer: crypto.randomUUID(),
    });
    expect(missing.isError).toBe(true);
    expect((missing.data.error as { code: string }).code).toBe("NOT_FOUND");
  });

  it("stops working as soon as admission is revoked", async () => {
    await pool.query("DELETE FROM membership_admission WHERE user_id=$1", [
      userId,
    ]);
    try {
      const response = await mcp(fullToken, "tools/list");
      expect(response.status).toBe(401);
    } finally {
      await pool.query(
        `INSERT INTO membership_admission(user_id, source) VALUES ($1, 'legacy')`,
        [userId],
      );
    }
  });
});
