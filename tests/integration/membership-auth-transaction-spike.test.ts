// S0 evidence for docs/adr/0001-membership-auth-transaction-boundary.md.
// Empirically proves, against the installed better-auth@1.7.5 + drizzle adapter,
// that a databaseHooks.user.create hook writing through the app's own db/pool
// handle is never part of the same database transaction as account creation -
// regardless of drizzleAdapter's `transaction` option or which sign-up route runs.
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { db, schema, pool } from "../../packages/database/src";

const TEST_SECRET = "membership-spike-test-secret-do-not-reuse-in-prod-32c";

type HookBehavior = { markerIdentifier: string; abort: boolean } | null;
let hookBehavior: HookBehavior = null;
let capturedOtp: string | null = null;

function buildSpikeAuth(transaction: boolean) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema, transaction }),
    secret: TEST_SECRET,
    baseURL: "http://localhost:3000",
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    rateLimit: { enabled: false },
    plugins: [
      emailOTP({
        disableSignUp: false,
        sendVerificationOTP: async ({ otp }) => {
          capturedOtp = otp;
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // Mirrors the naive approach the implementation plan explicitly warns
          // against: a hook doing its own write via the app's db, then aborting.
          before: async () => {
            if (!hookBehavior) return;
            await db.insert(schema.verification).values({
              identifier: hookBehavior.markerIdentifier,
              value: "membership-admission-spike",
              expiresAt: new Date(Date.now() + 60_000),
            });
            if (hookBehavior.abort) return false;
          },
        },
      },
    },
  });
}

const createdEmails: string[] = [];
const markerIdentifiers: string[] = [];

async function userExists(email: string) {
  const { rows } = await pool.query('SELECT id FROM "user" WHERE email=$1', [
    email,
  ]);
  return rows.length > 0;
}

async function markerCommitted(identifier: string) {
  const { rows } = await pool.query(
    'SELECT id FROM "verification" WHERE identifier=$1',
    [identifier],
  );
  return rows.length > 0;
}

afterEach(() => {
  hookBehavior = null;
  capturedOtp = null;
});

afterAll(async () => {
  if (createdEmails.length)
    await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [
      createdEmails,
    ]);
  if (markerIdentifiers.length)
    await pool.query(
      'DELETE FROM "verification" WHERE identifier = ANY($1::text[])',
      [markerIdentifiers],
    );
  await pool.end();
});

describe("S0 spike: installed better-auth transaction boundary around account creation", () => {
  it("password sign-up, default adapter config: aborting user creation does not roll back a hook's own db write", async () => {
    const auth = buildSpikeAuth(false);
    const email = `spike-pwd-default-${crypto.randomUUID()}@example.test`;
    const marker = `spike:pwd-default:${crypto.randomUUID()}`;
    createdEmails.push(email);
    markerIdentifiers.push(marker);
    hookBehavior = { markerIdentifier: marker, abort: true };

    await expect(
      auth.api.signUpEmail({
        body: { email, password: "correct horse battery", name: "Spike" },
      }),
    ).rejects.toThrow();

    expect(await userExists(email)).toBe(false);
    expect(await markerCommitted(marker)).toBe(true);
  });

  it("password sign-up with drizzleAdapter({ transaction: true }): the same naive hook write is still not rolled back", async () => {
    // /sign-up/email wraps its handler in better-auth's own runWithTransaction,
    // and with `transaction: true` that becomes a real db.transaction(). But our
    // hook writes through the app's plain `db` handle, on a separate connection,
    // so it is outside that transaction and survives the rollback anyway.
    const auth = buildSpikeAuth(true);
    const email = `spike-pwd-tx-${crypto.randomUUID()}@example.test`;
    const marker = `spike:pwd-tx:${crypto.randomUUID()}`;
    createdEmails.push(email);
    markerIdentifiers.push(marker);
    hookBehavior = { markerIdentifier: marker, abort: true };

    await expect(
      auth.api.signUpEmail({
        body: { email, password: "correct horse battery", name: "Spike" },
      }),
    ).rejects.toThrow();

    expect(await userExists(email)).toBe(false);
    expect(await markerCommitted(marker)).toBe(true);
  });

  it("email OTP sign-in auto-create: aborting user creation still leaves the marker write committed", async () => {
    // /sign-in/email-otp calls internalAdapter.createUser directly, with no
    // runWithTransaction wrapper at all (unlike /sign-up/email), so this is the
    // worst case: no transaction exists here for any adapter config to join.
    const auth = buildSpikeAuth(false);
    const email = `spike-otp-${crypto.randomUUID()}@example.test`;
    const marker = `spike:otp:${crypto.randomUUID()}`;
    createdEmails.push(email);
    markerIdentifiers.push(marker);

    await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    expect(capturedOtp).toMatch(/^\d{6}$/);

    hookBehavior = { markerIdentifier: marker, abort: true };
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: capturedOtp! } }),
    ).rejects.toThrow();

    expect(await userExists(email)).toBe(false);
    expect(await markerCommitted(marker)).toBe(true);
  });

  it("baseline: password sign-up without aborting still creates the user (hook wiring sanity check)", async () => {
    const auth = buildSpikeAuth(false);
    const email = `spike-pwd-baseline-${crypto.randomUUID()}@example.test`;
    createdEmails.push(email);
    hookBehavior = null;

    await auth.api.signUpEmail({
      body: { email, password: "correct horse battery", name: "Spike" },
    });

    expect(await userExists(email)).toBe(true);
  });
});
