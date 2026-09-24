import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { pool } from "../../packages/database/src";
/**
 * Public sign-up is gone (invitation-only membership, see
 * docs/invitation-membership-implementation-plan.md); these specs don't test
 * that path, they just need a working account. Creating one via direct DB
 * setup - a real password hash Better Auth can verify, plus a legacy
 * admission row - matches the plan's "createInvitedMember"-style fixture
 * (section 12) without adding any HTTP backdoor: nothing here is reachable
 * over the network, it is Node-side Playwright test code only.
 */
export const E2E_PASSWORD = "Local-test-passphrase-927!";
export async function createTestAccount(
  name: string,
  email: string,
  role: "USER" | "ADMIN" = "USER",
) {
  const userId = crypto.randomUUID();
  const hash = await hashPassword(E2E_PASSWORD);
  await pool.query(
    'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
    [userId, name, email, role],
  );
  await pool.query(
    "INSERT INTO account(id,account_id,provider_id,user_id,password) VALUES($1,$2,'credential',$1,$3)",
    [userId, userId, hash],
  );
  await pool.query(
    "INSERT INTO membership_admission(user_id, source) VALUES ($1, 'legacy')",
    [userId],
  );
  return userId;
}
export async function deleteTestAccount(email: string) {
  await pool.query(
    'DELETE FROM membership_admission WHERE user_id IN (SELECT id FROM "user" WHERE email=$1)',
    [email],
  );
  await pool.query('DELETE FROM "user" WHERE email=$1', [email]);
}
/** Fills and submits the sign-in form on whatever /sign-in?next=... page is already loaded, without navigating or asserting a destination. */
export async function submitSignIn(page: Page, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await submitSignIn(page, email);
  await expect(page).toHaveURL("/");
}
/** Creates the account and signs the page in, replacing the old public-signup flow in one call. */
export async function createAndSignIn(
  page: Page,
  name: string,
  email: string,
  role: "USER" | "ADMIN" = "USER",
) {
  await createTestAccount(name, email, role);
  await signIn(page, email);
}
