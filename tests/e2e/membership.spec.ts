import { test, expect, type Page } from "@playwright/test";
import { pool } from "../../packages/database/src";
import { runMailOutboxOnce } from "../../packages/database/src/mail-worker";
import { readCapturedMail } from "../../packages/shared/src/mail";
import { createTestAccount, deleteTestAccount, signIn } from "./fixtures";
/*
 * The beta journey: an invitation issued through the app and delivered by the
 * outbox worker to the capture transport -> join with an email code -> save a
 * place -> sign out -> sign back in with a new email code -> the same save.
 * The invitee never gets a password, and codes come only from captured mail,
 * never from the (hashed) verification table.
 */
// Invitation links and codes pass through these steps: no traces or screenshots.
test.use({ trace: "off", screenshot: "off", video: "off" });
const captureDir = process.env.E2E_MAIL_CAPTURE_DIR ?? "";
const PLACE = "/places/demo-little-taipei-noodle-house";
function captured(
  email: string,
  kind: "membership_invitation" | "membership_otp",
) {
  return readCapturedMail(captureDir).filter(
    (m) => m.to === email && m.kind === kind,
  );
}
async function waitForMail(
  email: string,
  kind: "membership_invitation" | "membership_otp",
  count: number,
) {
  await expect
    .poll(() => captured(email, kind).length, {
      timeout: 15_000,
      message: `No ${kind} captured. Is the web server running with the E2E capture mail settings?`,
    })
    .toBeGreaterThanOrEqual(count);
  return captured(email, kind)[count - 1];
}
function codeFrom(text: string) {
  const match = text.match(/\b\d{6}\b/);
  if (!match) throw new Error("No code in captured mail");
  return match[0];
}
async function requestSignInCode(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  const send = page.getByRole("button", {
    name: "Email me a code",
    exact: true,
  });
  const codeField = page.getByLabel("6-digit code", { exact: true });
  await send.click();
  // The join flow sent a code moments ago; wait out the 60-second resend cooldown if needed.
  const cooldown = page.getByText("You can request another code in");
  await expect(codeField.or(cooldown)).toBeVisible();
  if (await cooldown.isVisible()) {
    await expect(send).toBeEnabled({ timeout: 75_000 });
    await send.click();
  }
  await expect(codeField).toBeVisible();
  await expect(
    page.getByText("If this email belongs to a member"),
  ).toBeVisible();
  return codeField;
}
test.describe("invited member journey", () => {
  const stamp = Date.now();
  const adminEmail = `membership-admin-${stamp}@example.test`;
  const inviteeEmail = `membership-invitee-${stamp}@example.test`;
  let createdBatchId: string | null = null;
  /** An existing open batch borrowed for one extra seat, restored in afterAll. */
  let borrowedBatch: { id: string; capacity: number } | null = null;
  test.beforeAll(async () => {
    if (!captureDir)
      throw new Error(
        "E2E_MAIL_CAPTURE_DIR is not set; see playwright.config.ts.",
      );
    await createTestAccount("Membership Admin", adminEmail, "ADMIN");
    // Only one batch may be open at a time; if someone else's is open, borrow
    // a seat instead of closing it, and record the original capacity first.
    const open = await pool.query<{ id: string; capacity: number }>(
      `SELECT id, capacity FROM membership_batch WHERE status = 'open' LIMIT 1`,
    );
    if (open.rows[0]) {
      borrowedBatch = { id: open.rows[0].id, capacity: open.rows[0].capacity };
      await pool.query(
        `UPDATE membership_batch SET capacity = capacity + 1, updated_at = now() WHERE id = $1`,
        [borrowedBatch.id],
      );
    } else {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO membership_batch(name, capacity) VALUES ($1, 5) RETURNING id`,
        [`E2E ${stamp}`],
      );
      createdBatchId = created.rows[0].id;
    }
  });
  test.afterAll(async () => {
    try {
      await removeFixtures();
    } finally {
      // Runs even if a cleanup step fails: never leave the borrowed seat behind.
      if (borrowedBatch)
        await pool.query(
          `UPDATE membership_batch SET capacity = $2, updated_at = now() WHERE id = $1`,
          [borrowedBatch.id, borrowedBatch.capacity],
        );
    }
    // The capture directory belongs to the whole run; global-teardown removes it.
  });
  async function removeFixtures() {
    const invitee = await pool.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1',
      [inviteeEmail],
    );
    const admin = await pool.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1',
      [adminEmail],
    );
    const userIds = [...invitee.rows, ...admin.rows].map((r) => r.id);
    const nominations = `SELECT id FROM membership_nomination WHERE email_normalized = $1`;
    await pool.query(
      `DELETE FROM membership_audit WHERE actor_id = ANY($2::uuid[]) OR target_user_id = ANY($2::uuid[])
         OR nomination_id IN (${nominations})`,
      [inviteeEmail, userIds],
    );
    await pool.query(
      `DELETE FROM membership_join_context WHERE invitation_id IN (SELECT id FROM membership_invitation WHERE nomination_id IN (${nominations}))`,
      [inviteeEmail],
    );
    await pool.query(
      `DELETE FROM membership_admission WHERE user_id = ANY($1::uuid[])`,
      [userIds],
    );
    await pool.query(
      `DELETE FROM membership_invitation WHERE nomination_id IN (${nominations})`,
      [inviteeEmail],
    );
    await pool.query(
      `DELETE FROM membership_nomination WHERE email_normalized = $1`,
      [inviteeEmail],
    );
    await pool.query(`DELETE FROM mail_outbox WHERE recipient = $1`, [
      inviteeEmail,
    ]);
    if (createdBatchId)
      await pool.query(`DELETE FROM membership_batch WHERE id = $1`, [
        createdBatchId,
      ]);
    await pool.query('DELETE FROM "user" WHERE email = $1', [inviteeEmail]);
    await deleteTestAccount(adminEmail);
  }
  test("delivered invitation -> join -> save -> sign out -> email-code sign-in -> same save", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    // 1. An administrator issues an email invitation through the application.
    const adminPage = await (await browser.newContext()).newPage();
    await signIn(adminPage, adminEmail);
    await adminPage.goto("/admin/membership");
    const invitePanel = adminPage.locator("section", {
      has: adminPage.getByRole("heading", { name: "Invite someone directly" }),
    });
    await invitePanel.getByLabel("Email", { exact: true }).fill(inviteeEmail);
    await invitePanel.getByLabel("Email it for me").check();
    await invitePanel
      .getByRole("button", { name: "Create invitation" })
      .click();
    await expect
      .poll(
        async () =>
          (
            await pool.query(`SELECT 1 FROM mail_outbox WHERE recipient = $1`, [
              inviteeEmail,
            ])
          ).rowCount,
      )
      .toBe(1);
    // 2. The outbox worker delivers it to the capture transport.
    const summary = await runMailOutboxOnce();
    expect(summary.configurationError).toBeNull();
    const invitation = await waitForMail(
      inviteeEmail,
      "membership_invitation",
      1,
    );
    const link = invitation.text.match(/https?:\/\/\S+\/join#invite=\S+/)?.[0];
    if (!link) throw new Error("No invitation link in captured mail");
    const url = new URL(link);
    // 3. The invitee joins with an email code, in a fresh browser context.
    const page = await (await browser.newContext()).newPage();
    await page.goto(url.pathname + url.hash);
    await page
      .getByRole("button", { name: "Accept invitation, continue with email" })
      .click();
    const joinCode = codeFrom(
      (await waitForMail(inviteeEmail, "membership_otp", 1)).text,
    );
    await page.getByLabel("Code", { exact: true }).fill(joinCode);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL("/");
    // 4. Save a place.
    await page.goto(PLACE);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible();
    // 5. Sign out.
    await page.goto("/profile");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/");
    await page.goto(PLACE);
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toHaveCount(0);
    // 6. Sign back in with a new email code (keyboard only for the code step).
    const codeField = await requestSignInCode(page, inviteeEmail);
    const signInCode = codeFrom(
      (await waitForMail(inviteeEmail, "membership_otp", 2)).text,
    );
    expect(signInCode).not.toBe(joinCode);
    await codeField.focus();
    await page.keyboard.type(signInCode);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/");
    // 7. Same account, same saved place; the invitee never had a password.
    await page.goto(PLACE);
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible();
    const credentials = await pool.query(
      `SELECT 1 FROM account a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1 AND a.password IS NOT NULL`,
      [inviteeEmail],
    );
    expect(credentials.rowCount).toBe(0);
  });
  test("the email-code form fits a 320px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/sign-in");
    await expect(
      page.getByRole("button", { name: "Email me a code", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  });
});
