import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { pool } from "../../packages/database/src";
import { POST } from "../../apps/web/src/app/api/auth/[...all]/route";
import { membershipMode } from "../../apps/web/src/lib/config";
import { resolveActor } from "../../apps/web/src/lib/session";
import { createJoinContext } from "../../apps/web/src/features/membership/service";
import { localTestMailer } from "../../packages/shared/src/mail";
/*
 * Runs in its own file so every app module (lib/config reads MEMBERSHIP_MODE
 * once, at import) initializes with membership closed. The integration config
 * sets invite_only for other files; vitest hoists this override above the
 * imports, and afterAll restores it.
 */
const previousMode = vi.hoisted(() => {
  const previous = process.env.MEMBERSHIP_MODE;
  process.env.MEMBERSHIP_MODE = "closed";
  return previous;
});
const email = `closed-${crypto.randomUUID()}@closed-mode-test.example`;
function post(path: string, body: unknown) {
  return POST(
    new NextRequest(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.99.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`,
      },
      body: JSON.stringify(body),
    }),
  );
}
afterAll(async () => {
  await pool.query(
    `DELETE FROM membership_admission WHERE user_id IN (SELECT id FROM "user" WHERE email = $1)`,
    [email],
  );
  await pool.query(`DELETE FROM verification WHERE identifier = $1`, [
    `sign-in-otp-${email}`,
  ]);
  await pool.query('DELETE FROM "user" WHERE email = $1', [email]);
  await pool.end();
  if (previousMode === undefined) delete process.env.MEMBERSHIP_MODE;
  else process.env.MEMBERSHIP_MODE = previousMode;
});
describe("MEMBERSHIP_MODE=closed", () => {
  it("still lets an admitted member sign in with an email code, while joining is closed", async () => {
    expect(membershipMode).toBe("closed");
    await expect(
      createJoinContext({ token: "x".repeat(40) }),
    ).rejects.toMatchObject({
      code: "MEMBERSHIP_PAUSED",
    });
    const userId = crypto.randomUUID();
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [userId, "Closed Mode Member", email, "USER"],
    );
    await pool.query(
      `INSERT INTO membership_admission(user_id, source) VALUES ($1, 'legacy')`,
      [userId],
    );
    const requested = await post("/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    expect(requested.status).toBe(200);
    const code = localTestMailer.sent
      .filter((m) => m.to === email && m.kind === "membership_otp")
      .map((m) => m.text.match(/\d{6}/)?.[0])[0];
    expect(code).toBeTruthy();
    const verified = await post("/sign-in/email-otp", { email, otp: code });
    expect(verified.status).toBe(200);
    const cookie = verified.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect((await resolveActor(new Headers({ cookie })))?.id).toBe(userId);
  });
});
