import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { pool } from "../../packages/database/src";
import { POST } from "../../apps/web/src/app/api/auth/[...all]/route";
import { POST as v1Handler } from "../../apps/web/src/app/api/v1/[...path]/route";
import { POST as uploadImage } from "../../apps/web/src/app/api/v1/images/route";
/*
 * The real /api/v1 and upload route handlers read the session through
 * next/headers, which only works inside a Next request scope. Only that
 * accessor is stubbed, to return the test request's own headers; session
 * resolution, admission lookup and the handlers themselves are real.
 */
const nextRequestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => nextRequestHeaders.current,
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    has: () => false,
  }),
}));
import { auth } from "../../apps/web/src/lib/auth";
import { resolveActor } from "../../apps/web/src/lib/session";
import {
  adminDirectInvite,
  createBatch,
  createJoinContext,
  joinEmailComplete,
  joinEmailStart,
  revokeInvitation,
  updateBatch,
} from "../../apps/web/src/features/membership/service";
import { resetCodeSendLimits } from "../../apps/web/src/features/membership/rate-limit";
import { findLegacyCandidates } from "../../packages/database/src/membership-legacy-backfill";
import { localTestMailer } from "../../packages/shared/src/mail";
import type { Actor } from "../../packages/shared/src";
/*
 * HTTP-level checks of the native Better Auth email-code routes as wrapped by
 * app/api/auth/[...all]/route.ts, plus the admission-aware actor boundary
 * (lib/session.ts resolveActor) for cookie and bearer sessions. Runs against
 * the disposable test database with the in-memory mail transport only.
 */
const admin: Actor = { id: crypto.randomUUID(), role: "ADMIN" };
const cleanupEmails: string[] = [];
let batchId: string;
function testEmail(prefix: string) {
  const email = `${prefix}-${crypto.randomUUID()}@auth-boundary-test.example`;
  cleanupEmails.push(email);
  return email;
}
/** A fresh single-value x-forwarded-for keeps Better Auth's own per-IP limiter out of the way. */
function randomIp() {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
}
function post(path: string, body: unknown) {
  return POST(
    new NextRequest(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": randomIp(),
      },
      body: JSON.stringify(body),
    }),
  );
}
const requestCode = (email: string) =>
  post("/email-otp/send-verification-otp", { email, type: "sign-in" });
const verifyCode = (email: string, otp: string) =>
  post("/sign-in/email-otp", { email, otp });
function codesSentTo(email: string) {
  return localTestMailer.sent
    .filter((m) => m.to === email && m.kind === "membership_otp")
    .map((m) => m.text.match(/\d{6}/)?.[0] ?? "");
}
function wrongCode(code: string) {
  return code === "000000" ? "111111" : "000000";
}
async function makeUser(email: string, admitted: boolean) {
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
    [id, "Boundary Test", email, "USER"],
  );
  if (admitted)
    await pool.query(
      `INSERT INTO membership_admission(user_id, source) VALUES ($1, 'legacy')`,
      [id],
    );
  return id;
}
/** account.id/user_id are uuid, account_id is text: separate, explicitly typed parameters. */
async function insertCredentialAccount(userId: string) {
  await pool.query(
    "INSERT INTO account(id,account_id,provider_id,user_id) VALUES($1::uuid,$2::text,'credential',$3::uuid)",
    [crypto.randomUUID(), userId, userId],
  );
}
async function manualInvite(email: string) {
  const invite = await adminDirectInvite(admin, {
    email,
    batchId,
    delivery: "manual",
  });
  if (invite.delivery !== "manual") throw new Error("expected manual delivery");
  return {
    ...invite,
    token: new URL(invite.link).hash.replace("#invite=", ""),
  };
}
function cookieHeader(response: { headers: Headers }) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
type TestSession = { email: string; cookie: string; token: string };
/** A real session for an admitted member, obtained through the native code routes. */
async function admittedSession(
  prefix: string,
): Promise<TestSession & { userId: string }> {
  const email = testEmail(prefix);
  const userId = await makeUser(email, true);
  await requestCode(email);
  const [code] = codesSentTo(email);
  const response = await verifyCode(email, code);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string };
  return { email, userId, cookie: cookieHeader(response), token: body.token };
}
/**
 * A real Better Auth session with no admission: the interrupted-join state,
 * where the OTP call created the user and a session but admission never ran.
 */
async function unadmittedSession(prefix: string): Promise<TestSession> {
  const email = testEmail(prefix);
  const invite = await manualInvite(email);
  const context = await createJoinContext({ token: invite.token });
  await joinEmailStart(context.secret, { acceptTerms: true });
  const [code] = codesSentTo(email);
  const result = (await auth.api.signInEmailOTP({
    body: { email, otp: code },
    returnHeaders: true,
  })) as { headers: Headers; response: { token: string } };
  return { email, cookie: cookieHeader(result), token: result.response.token };
}
function sessionHeaders(
  session: TestSession,
  via: "cookie" | "bearer",
  extra: Record<string, string> = {},
) {
  const headers = new Headers(extra);
  if (via === "cookie") headers.set("cookie", session.cookie);
  else headers.set("authorization", `Bearer ${session.token}`);
  return headers;
}
/** Calls the real /api/v1 catch-all handler (one function for every method). */
function callV1(
  method: string,
  path: string[],
  headers: Headers,
  body?: unknown,
) {
  headers.set("content-type", "application/json");
  nextRequestHeaders.current = headers;
  return v1Handler(
    new NextRequest(`http://localhost:3000/api/v1/${path.join("/")}`, {
      method,
      headers,
      body:
        method === "GET" || method === "DELETE"
          ? undefined
          : JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ path }) },
  );
}
function callUpload(headers: Headers) {
  nextRequestHeaders.current = headers;
  const form = new FormData();
  // A valid 1x1 PNG signature so only authorization decides the outcome.
  form.set(
    "image",
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "x.png", {
      type: "image/png",
    }),
  );
  return uploadImage(
    new NextRequest("http://localhost:3000/api/v1/images", {
      method: "POST",
      headers,
      body: form,
    }),
  );
}
beforeAll(async () => {
  await pool.query(
    'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
    [admin.id, "Boundary Admin", `${admin.id}@example.test`, "ADMIN"],
  );
  batchId = (
    await createBatch(admin, {
      name: `Boundary ${crypto.randomUUID()}`,
      capacity: 20,
    })
  ).id;
});
afterEach(() => {
  localTestMailer.sent = [];
});
afterAll(async () => {
  await updateBatch(admin, batchId, { status: "closed" });
  const userIds = (
    await pool.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = ANY($1::text[])',
      [cleanupEmails],
    )
  ).rows.map((r) => r.id);
  const all = [...userIds, admin.id];
  await pool.query(
    `DELETE FROM membership_admission WHERE user_id = ANY($1::uuid[])`,
    [all],
  );
  await pool.query(
    `DELETE FROM membership_audit WHERE actor_id = ANY($1::uuid[]) OR target_user_id = ANY($1::uuid[])`,
    [all],
  );
  await pool.query(
    `DELETE FROM membership_join_context WHERE invitation_id IN (SELECT i.id FROM membership_invitation i JOIN membership_nomination n ON n.id = i.nomination_id WHERE n.email_normalized = ANY($1::text[]))`,
    [cleanupEmails],
  );
  await pool.query(
    `DELETE FROM membership_invitation WHERE nomination_id IN (SELECT id FROM membership_nomination WHERE email_normalized = ANY($1::text[]))`,
    [cleanupEmails],
  );
  await pool.query(
    `DELETE FROM membership_nomination WHERE email_normalized = ANY($1::text[])`,
    [cleanupEmails],
  );
  await pool.query(
    `DELETE FROM verification WHERE identifier = ANY($1::text[])`,
    [cleanupEmails.map((e) => `sign-in-otp-${e}`)],
  );
  await pool.query(`DELETE FROM membership_batch WHERE id = $1`, [batchId]);
  await pool.query(`DELETE FROM "user" WHERE id = ANY($1::uuid[])`, [all]);
  await pool.end();
});
describe("returning-member code requests", () => {
  it("sends only to admitted members and answers everyone identically", async () => {
    const admitted = testEmail("admitted");
    const seedOnly = testEmail("seed");
    const inviteOnly = testEmail("invite-only");
    const unknown = testEmail("unknown");
    await makeUser(admitted, true);
    await makeUser(seedOnly, false);
    await manualInvite(inviteOnly);
    const bodies: unknown[] = [];
    for (const email of [admitted, seedOnly, inviteOnly, unknown]) {
      const response = await requestCode(email);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      bodies.push(await response.json());
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(codesSentTo(admitted)).toHaveLength(1);
    for (const email of [seedOnly, inviteOnly, unknown])
      expect(codesSentTo(email)).toHaveLength(0);
    // Nothing is created for ineligible addresses.
    const users = await pool.query(
      'SELECT 1 FROM "user" WHERE email = ANY($1::text[])',
      [[inviteOnly, unknown]],
    );
    expect(users.rowCount).toBe(0);
  });
  it("stores only a hash of the code", async () => {
    const email = testEmail("hashed");
    await makeUser(email, true);
    await requestCode(email);
    const [code] = codesSentTo(email);
    const stored = await pool.query<{ value: string }>(
      `SELECT value FROM verification WHERE identifier = $1`,
      [`sign-in-otp-${email}`],
    );
    expect(stored.rows[0].value).not.toContain(code);
  });
  it("applies the resend cooldown to eligible and ineligible addresses alike", async () => {
    for (const [email, admitted] of [
      [testEmail("cool-a"), true],
      [testEmail("cool-b"), false],
    ] as const) {
      if (admitted) await makeUser(email, true);
      expect((await requestCode(email)).status).toBe(200);
      const second = await requestCode(email);
      expect(second.status).toBe(429);
      expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    }
  });
  it("rejects malformed input and unsupported OTP purposes", async () => {
    expect((await requestCode("not-an-email")).status).toBe(400);
    expect(
      (
        await post("/email-otp/send-verification-otp", {
          email: testEmail("x"),
          type: "forget-password",
        })
      ).status,
    ).toBe(400);
    for (const path of [
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
    ])
      expect(
        (await post(path, { email: testEmail("blocked"), otp: "123456" }))
          .status,
      ).toBe(404);
    const oversized = await post("/email-otp/send-verification-otp", {
      email: testEmail("big"),
      type: "sign-in",
      padding: "x".repeat(5000),
    });
    expect(oversized.status).toBe(413);
  });
});
describe("returning-member sign-in", () => {
  it("signs an admitted member in and yields an actor for both cookie and bearer sessions", async () => {
    const email = testEmail("signin");
    const userId = await makeUser(email, true);
    await requestCode(email);
    const [code] = codesSentTo(email);
    const response = await verifyCode(email, code);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    expect(
      (await resolveActor(new Headers({ cookie: cookieHeader(response) })))?.id,
    ).toBe(userId);
    expect(
      (
        await resolveActor(
          new Headers({ authorization: `Bearer ${body.token}` }),
        )
      )?.id,
    ).toBe(userId);
  });
  it("rejects a wrong, replayed or exhausted code", async () => {
    const email = testEmail("wrong");
    await makeUser(email, true);
    await requestCode(email);
    const [code] = codesSentTo(email);
    const wrong = await verifyCode(email, wrongCode(code));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).code).toBe("INVALID_OTP");
    expect((await verifyCode(email, code)).status).toBe(200);
    // Replayed, exhausted and expired codes give exactly the answer an
    // ineligible address gets, so none of them reveals membership.
    const generic = { code: "INVALID_OTP", message: "Invalid OTP" };
    const replay = await verifyCode(email, code);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual(generic);
    await resetCodeSendLimits(email);
    await requestCode(email);
    const fresh = codesSentTo(email)[1];
    for (let i = 0; i < 3; i++) await verifyCode(email, wrongCode(fresh));
    const exhausted = await verifyCode(email, fresh);
    expect(exhausted.status).toBe(400);
    expect(await exhausted.json()).toEqual(generic);
    await resetCodeSendLimits(email);
    await requestCode(email);
    const toExpire = codesSentTo(email)[2];
    await pool.query(
      `UPDATE verification SET expires_at = now() - interval '1 second' WHERE identifier = $1`,
      [`sign-in-otp-${email}`],
    );
    const expired = await verifyCode(email, toExpire);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual(generic);
  });
  it("applies the verify limits to ineligible addresses too", async () => {
    const unknown = testEmail("verify-limit");
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await verifyCode(unknown, "123456")).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
  it("rotates the code on resend", async () => {
    const email = testEmail("rotate");
    await makeUser(email, true);
    await requestCode(email);
    await resetCodeSendLimits(email);
    await requestCode(email);
    const [first, second] = codesSentTo(email);
    if (first !== second)
      expect((await verifyCode(email, first)).status).toBe(400);
    expect((await verifyCode(email, second)).status).toBe(200);
  });
  it("denies unknown, seed-only and partial-join users without revealing why", async () => {
    const seedOnly = testEmail("seed-verify");
    await makeUser(seedOnly, false);
    const partial = testEmail("partial");
    const invite = await manualInvite(partial);
    const context = await createJoinContext({ token: invite.token });
    await joinEmailStart(context.secret, { acceptTerms: true });
    const [firstCode] = codesSentTo(partial);
    // Interrupted join: Better Auth created the user and a session, admission never ran.
    const interrupted = (await auth.api.signInEmailOTP({
      body: { email: partial, otp: firstCode },
    })) as { token: string };
    expect(
      await resolveActor(
        new Headers({ authorization: `Bearer ${interrupted.token}` }),
      ),
    ).toBeNull();
    await resetCodeSendLimits(partial);
    await joinEmailStart(context.secret, { acceptTerms: true });
    const pendingCode = codesSentTo(partial)[1];
    for (const [email, otp] of [
      [testEmail("unknown-verify"), "123456"],
      [seedOnly, "123456"],
      [partial, pendingCode],
    ]) {
      const response = await verifyCode(email, otp);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: "INVALID_OTP",
        message: "Invalid OTP",
      });
      expect(response.headers.getSetCookie()).toHaveLength(0);
    }
    // The partial join still finishes through its invitation, with the same code.
    expect(
      await joinEmailComplete(context.secret, { otp: pendingCode }, () => {}),
    ).toEqual({
      joined: true,
    });
  });
  it("lets a member whose join response was lost sign in with a new code", async () => {
    const email = testEmail("lost-response");
    const invite = await manualInvite(email);
    const context = await createJoinContext({ token: invite.token });
    await joinEmailStart(context.secret, { acceptTerms: true });
    const [joinCode] = codesSentTo(email);
    await joinEmailComplete(context.secret, { otp: joinCode }, () => {});
    await resetCodeSendLimits(email);
    await requestCode(email);
    const code = codesSentTo(email)[1];
    expect(code).toBeTruthy();
    expect((await verifyCode(email, code)).status).toBe(200);
  });
});
describe("join finalization", () => {
  it("refuses to verify a code before the invitation is accepted, creating no account", async () => {
    const email = testEmail("no-terms");
    const invite = await manualInvite(email);
    const context = await createJoinContext({ token: invite.token });
    await expect(
      joinEmailComplete(context.secret, { otp: "123456" }, () => {}),
    ).rejects.toMatchObject({ code: "TERMS_REQUIRED" });
    const users = await pool.query('SELECT 1 FROM "user" WHERE email = $1', [
      email,
    ]);
    expect(users.rowCount).toBe(0);
  });
  it("rejects completion after the invitation is revoked mid-join", async () => {
    const email = testEmail("revoked-mid-join");
    const invite = await manualInvite(email);
    const context = await createJoinContext({ token: invite.token });
    await joinEmailStart(context.secret, { acceptTerms: true });
    const [code] = codesSentTo(email);
    await revokeInvitation(admin, invite.invitationId, {});
    await expect(
      joinEmailComplete(context.secret, { otp: code }, () => {}),
    ).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
    const admission = await pool.query(
      `SELECT 1 FROM membership_admission a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1`,
      [email],
    );
    expect(admission.rowCount).toBe(0);
  });
  it("admits exactly once when the same completion races, forwarding cookies only on success", async () => {
    const email = testEmail("race");
    const invite = await manualInvite(email);
    const context = await createJoinContext({ token: invite.token });
    await joinEmailStart(context.secret, { acceptTerms: true });
    const [code] = codesSentTo(email);
    const forwarded: number[] = [];
    const results = await Promise.allSettled([
      joinEmailComplete(context.secret, { otp: code }, (h) =>
        forwarded.push(h.getSetCookie().length),
      ),
      joinEmailComplete(context.secret, { otp: code }, (h) =>
        forwarded.push(h.getSetCookie().length),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toBeGreaterThan(0);
    const admissions = await pool.query(
      `SELECT 1 FROM membership_admission a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1`,
      [email],
    );
    expect(admissions.rowCount).toBe(1);
    const audits = await pool.query(
      `SELECT 1 FROM membership_audit WHERE action = 'membership_joined' AND invitation_id = $1`,
      [invite.invitationId],
    );
    expect(audits.rowCount).toBe(1);
  });
});
describe("protected actions over HTTP", () => {
  let placeId: string;
  beforeAll(async () => {
    const place = await pool.query<{ id: string }>(
      `SELECT id FROM place WHERE status = 'approved' ORDER BY id LIMIT 1`,
    );
    if (!place.rows[0])
      throw new Error("Needs a seeded, approved place (pnpm db:seed).");
    placeId = place.rows[0].id;
  });
  it("lets an admitted session save through the real handler (harness check)", async () => {
    const member = await admittedSession("protected-ok");
    for (const via of ["cookie", "bearer"] as const) {
      const saved = await callV1(
        "POST",
        ["places", placeId, "save"],
        sessionHeaders(member, via),
      );
      expect(saved.status).toBe(200);
      const unsaved = await callV1(
        "DELETE",
        ["places", placeId, "save"],
        sessionHeaders(member, via),
      );
      expect(unsaved.status).toBe(200);
    }
  });
  it("treats a session without admission as signed out for saves, uploads and membership", async () => {
    const partial = await unadmittedSession("protected-denied");
    for (const via of ["cookie", "bearer"] as const) {
      const save = await callV1(
        "POST",
        ["places", placeId, "save"],
        sessionHeaders(partial, via),
      );
      expect(save.status).toBe(401);
      expect((await save.json()).error.code).toBe("UNAUTHORIZED");
      const saved = await callV1(
        "GET",
        ["saved"],
        sessionHeaders(partial, via),
      );
      expect(saved.status).toBe(401);
      const membership = await callV1(
        "GET",
        ["membership"],
        sessionHeaders(partial, via),
      );
      expect(membership.status).toBe(401);
      const upload = await callUpload(sessionHeaders(partial, via));
      expect(upload.status).toBe(401);
    }
    const stored = await pool.query(
      `SELECT 1 FROM saved_place s JOIN "user" u ON u.id = s.user_id WHERE u.email = $1`,
      [partial.email],
    );
    expect(stored.rowCount).toBe(0);
  });
  it("gets an admitted upload past authorization (stopped by the origin check, nothing stored)", async () => {
    const member = await admittedSession("upload-ok");
    for (const via of ["cookie", "bearer"] as const) {
      const upload = await callUpload(
        sessionHeaders(member, via, { origin: "https://not-this-app.example" }),
      );
      expect(upload.status).toBe(403);
    }
  });
});
describe("failed admission finalization", () => {
  it("removes the provisional session, forwards no cookie, and can be retried", async () => {
    const email = testEmail("finalize-fails");
    const invite = await manualInvite(email);
    const context = await createJoinContext({ token: invite.token });
    await joinEmailStart(context.secret, { acceptTerms: true });
    const [code] = codesSentTo(email);
    // Test-scoped fault injection on the disposable database: the admission
    // insert fails for this one address only, after Better Auth has created
    // the user and a session.
    const suffix = crypto.randomUUID().replace(/-/g, "");
    const fn = `test_fail_admission_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN
         IF EXISTS (SELECT 1 FROM "user" WHERE id = NEW.user_id AND email = '${email}') THEN
           RAISE EXCEPTION 'injected admission failure';
         END IF;
         RETURN NEW;
       END $fn$`,
    );
    await pool.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON membership_admission FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    const forwarded: string[][] = [];
    try {
      await expect(
        joinEmailComplete(context.secret, { otp: code }, (h) =>
          forwarded.push(h.getSetCookie()),
        ),
      ).rejects.toThrow("injected admission failure");
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON membership_admission`);
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    expect(forwarded).toHaveLength(0);
    const state = await pool.query<{
      sessions: number;
      admitted: number;
      status: string;
    }>(
      `SELECT
         (SELECT count(*)::int FROM session s JOIN "user" u ON u.id = s.user_id WHERE u.email = $1) AS sessions,
         (SELECT count(*)::int FROM membership_admission a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1) AS admitted,
         (SELECT status FROM membership_invitation WHERE id = $2) AS status`,
      [email, invite.invitationId],
    );
    expect(state.rows[0]).toEqual({
      sessions: 0,
      admitted: 0,
      status: "issued",
    });
    // The partial account resumes through the same invitation with a new code.
    await resetCodeSendLimits(email);
    await joinEmailStart(context.secret, { acceptTerms: true });
    const retryCode = codesSentTo(email)[1];
    const cookies: string[] = [];
    expect(
      await joinEmailComplete(context.secret, { otp: retryCode }, (h) =>
        cookies.push(...h.getSetCookie()),
      ),
    ).toEqual({ joined: true });
    expect(cookies.length).toBeGreaterThan(0);
  });
});
describe("native route spellings", () => {
  it("refuses non-canonical spellings of guarded and blocked OTP routes", async () => {
    const seedOnly = testEmail("spelling-seed");
    await makeUser(seedOnly, false);
    for (const path of [
      "/sign-in/email-otp/",
      "/sign-in//email-otp",
      "/Sign-In/Email-OTP",
      "/sign-in/email%2Dotp",
      "/email-otp/send-verification-otp/",
      "/EMAIL-OTP/send-verification-otp",
      "/email-otp/verify-email/",
      "/email-otp/reset-password/",
      "/email-otp/Reset-Password",
      "/forget-password/email-otp/",
    ]) {
      const response = await post(path, {
        email: seedOnly,
        otp: "123456",
        type: "sign-in",
      });
      expect(response.status, path).toBe(404);
      expect(response.headers.getSetCookie(), path).toHaveLength(0);
    }
    expect(codesSentTo(seedOnly)).toHaveLength(0);
  });
});
describe("legacy backfill candidates", () => {
  it("includes genuine credential accounts and excludes seed-only and partial-join accounts", async () => {
    const legacy = testEmail("legacy");
    const legacyId = await makeUser(legacy, false);
    await insertCredentialAccount(legacyId);
    const seedOnly = testEmail("legacy-seed");
    const seedId = await makeUser(seedOnly, false);
    const partial = testEmail("legacy-partial");
    await manualInvite(partial);
    const partialId = await makeUser(partial, false);
    await insertCredentialAccount(partialId);
    const ids = (await findLegacyCandidates()).map((c) => c.id);
    expect(ids).toContain(legacyId);
    expect(ids).not.toContain(seedId);
    expect(ids).not.toContain(partialId);
    await pool.query(`DELETE FROM account WHERE user_id = ANY($1::uuid[])`, [
      [legacyId, partialId],
    ]);
  });
});
