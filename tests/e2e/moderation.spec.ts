import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import "dotenv/config";
test("event contribution stays private until an admin approves it", async ({
  page,
}) => {
  const email = `moderation-${Date.now()}@example.test`;
  const name = `Community supper ${Date.now()}`;
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Display name").fill("Moderation Test");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Local-test-passphrase-927!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await page.goto("/submit/event");
  await page.getByLabel("Name / title").fill(name);
  await page
    .getByLabel("Description", { exact: true })
    .fill("A fictional dinner for the automated browser test.");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Food");
  await page.getByLabel("Neighborhood", { exact: true }).fill("Midtown");
  await page.getByLabel("Address", { exact: true }).fill("100 Demo Lane");
  await page
    .getByRole("combobox", { name: "Organizer", exact: true })
    .selectOption("00000000-0000-4000-8000-000000004000");
  await page.getByLabel("Venue", { exact: true }).fill("Demo Kitchen");
  const start = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
  const end = new Date(Date.now() + 3 * 86400000 + 7200000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Start time", { exact: true }).fill(start);
  await page.getByLabel("End time", { exact: true }).fill(end);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Thanks! Your submission is pending community moderation.",
  );
  const search = await page.request.get(
    "/api/v1/events?q=" + encodeURIComponent(name),
  );
  expect((await search.json()).data.total).toBe(0);
  const denied = await page.request.post("/api/v1/admin", { data: {} });
  expect(denied.status()).toBe(403);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('UPDATE "user" SET role=$1 WHERE email=$2', [
      "ADMIN",
      email,
    ]);
    await page.goto("/admin");
    const entry = page
      .locator(".admin-item")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(entry).toBeVisible();
    await entry.getByRole("textbox").fill("Reviewed browser test event.");
    await entry.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(entry).toHaveCount(0);
    await page.goto("/events?q=" + encodeURIComponent(name));
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  } finally {
    await pool.query('UPDATE "user" SET role=$1 WHERE email=$2', [
      "USER",
      email,
    ]);
    await pool.end();
  }
});
