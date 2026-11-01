import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import "dotenv/config";
import { createAndSignIn } from "./fixtures";
test("event contribution stays private until an admin approves it", async ({
  page,
}) => {
  const email = `moderation-${Date.now()}@example.test`;
  const name = `Community supper ${Date.now()}`;
  await createAndSignIn(page, "Moderation Test", email);
  // Contributions are API-only now (the /submit pages were removed); the
  // moderation queue and approval flow are what this test covers.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const city = await pool.query<{ id: string }>(
    "SELECT id FROM city WHERE slug='houston'",
  );
  const startTime = new Date(Date.now() + 3 * 86400000);
  const created = await page.request.post("/api/v1/events", {
    data: {
      name,
      nameChinese: "",
      description: "A fictional dinner for the automated browser test.",
      cityId: city.rows[0].id,
      neighborhood: "Midtown",
      address: "100 Demo Lane",
      latitude: 29.74,
      longitude: -95.38,
      category: "Food",
      organizerId: "00000000-0000-4000-8000-000000004000",
      venue: "Demo Kitchen",
      startTime: startTime.toISOString(),
      endTime: new Date(startTime.getTime() + 7200000).toISOString(),
    },
  });
  expect(created.status()).toBe(201);
  const search = await page.request.get(
    "/api/v1/events?q=" + encodeURIComponent(name),
  );
  expect((await search.json()).data.total).toBe(0);
  const denied = await page.request.post("/api/v1/admin", { data: {} });
  expect(denied.status()).toBe(403);
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
    // The event this test approves stays (submitted_by references this
    // account, and browser tests intentionally leave contribution fixtures
    // per AGENTS.md), so the account can't be deleted either - just end the pool.
    await pool.end();
  }
});
