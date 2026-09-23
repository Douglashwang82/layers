import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import "dotenv/config";
test("an admin manages extraction source pages from the web app", async ({
  page,
}) => {
  const email = `extraction-${Date.now()}@example.test`;
  const slug = `browser-${Date.now()}`;
  const url = `https://example.org/browser-place-${Date.now()}`;
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Display name").fill("Extraction Test");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Local-test-passphrase-927!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  // A plain account may not reach the source pages at all.
  await page.goto("/admin/extraction");
  await expect(
    page.getByRole("heading", { name: "Add a source page" }),
  ).toHaveCount(0);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('UPDATE "user" SET role=$1 WHERE email=$2', [
      "ADMIN",
      email,
    ]);
    await page.goto("/admin/extraction");
    await page.getByLabel("Page URL").fill(url);
    await page.getByLabel("Feed slug").fill(slug);
    await page.getByLabel("Source label").fill("Browser probe");
    await page
      .getByLabel("Permission note")
      .fill("Owner allows reuse of stated facts; checked in browser test.");
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    const entry = page
      .locator(".admin-item")
      .filter({ has: page.getByRole("heading", { name: "Browser probe" }) });
    await expect(entry).toBeVisible();
    // Added paused, so the next scheduled run ignores it.
    await expect(entry.getByText(`${slug} · places · Paused`)).toBeVisible();
    await entry.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(entry.getByText(`${slug} · places · Enabled`)).toBeVisible();
    expect(
      (
        await pool.query(
          "SELECT enabled FROM extraction_page WHERE feed_slug=$1",
          [slug],
        )
      ).rows[0].enabled,
    ).toBe(true);
    await entry.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(entry).toHaveCount(0);
    expect(
      (
        await pool.query("SELECT id FROM extraction_page WHERE feed_slug=$1", [
          slug,
        ])
      ).rowCount,
    ).toBe(0);
  } finally {
    await pool.query("DELETE FROM extraction_page WHERE feed_slug=$1", [slug]);
    await pool.query('UPDATE "user" SET role=$1 WHERE email=$2', [
      "USER",
      email,
    ]);
    await pool.end();
  }
});
