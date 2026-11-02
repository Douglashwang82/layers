import { verifyJwsAccessToken } from "better-auth/oauth2";
import type { Actor } from "@taiwanhub/shared";
import { auth } from "@/lib/auth";
import { resolveMcpActor } from "@/lib/session";
import { mcpIssuer, mcpResource, mcpScopes } from "./config";

/** RFC 9728 metadata URL for the MCP resource (path-inserted form). */
export const protectedResourceMetadataUrl = (() => {
  const url = new URL(mcpResource);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
})();

/** RFC 6750/9728 challenge that tells ChatGPT/Claude where to start OAuth. */
export function unauthorized(description = "Sign in to use LocalLink.") {
  const challenge = [
    `Bearer resource_metadata="${protectedResourceMetadataUrl}"`,
    `scope="${mcpScopes.join(" ")}"`,
    `error="invalid_token"`,
    `error_description="${description.replace(/"/g, "'")}"`,
  ].join(", ");
  return new Response(
    JSON.stringify({ error: "invalid_token", error_description: description }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "WWW-Authenticate": challenge,
      },
    },
  );
}

// Stable cache key so the signing keys are re-read only on expiry or kid miss.
const jwksCacheKey = {};

export type McpPrincipal = { actor: Actor; scopes: string[] };

/**
 * Verify the bearer access token locally (signature from the jwks table,
 * issuer, audience = this resource, expiry), then resolve an admitted member.
 * Returns null for every failure so callers answer with one challenge.
 */
export async function authenticateMcpRequest(
  request: Request,
): Promise<McpPrincipal | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
  if (!match) return null;
  let payload;
  try {
    payload = await verifyJwsAccessToken(match[1], {
      jwksFetch: () => auth.api.getJwks(),
      jwksCacheKey,
      verifyOptions: { issuer: mcpIssuer, audience: mcpResource },
    });
  } catch {
    return null;
  }
  // Sender-constrained (DPoP) tokens are not accepted as plain bearer tokens.
  if (payload.cnf !== undefined) return null;
  const actor = await resolveMcpActor(payload.sub);
  if (!actor) return null;
  const scopes =
    typeof payload.scope === "string"
      ? payload.scope.split(" ").filter(Boolean)
      : [];
  return { actor, scopes };
}
