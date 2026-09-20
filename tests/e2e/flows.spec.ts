import { test, expect } from "@playwright/test";
test("guest discovery, Chinese search, and responsive navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Discover Houston through Taiwanese eyes.",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "Search TaiwanHub" }).fill("義美");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "I-Mei Chocolate Puffs", exact: true }),
  ).toBeVisible();
  await page.goto("/events?period=weekend");
  await expect(page.locator(".events-card").first()).toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Discover Houston through Taiwanese eyes.",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(768);
  await page.screenshot({
    path: "test-results/home-tablet.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Discover Houston through Taiwanese eyes.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Language" }).click();
  await expect(
    page.getByRole("heading", { name: "用台灣人的視角，發現休士頓。" }),
  ).toBeVisible();
});
test("create account, save, change recommendation, RSVP and report a product sighting", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Display name").fill("Browser Neighbor");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`browser-${Date.now()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Local-test-passphrase-927!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await page.goto("/places/demo-little-taipei-noodle-house");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Yes, recommend", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Yes, recommend", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Not for me", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Not for me", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto("/events");
  await page.locator(".events-card a").first().click();
  await page.getByRole("button", { name: "RSVP", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel RSVP" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel RSVP" }).click();
  await expect(
    page.getByRole("button", { name: "RSVP", exact: true }),
  ).toBeVisible();
  await page.goto("/products/demo-i-mei-chocolate-puffs");
  await page.getByRole("link", { name: "I found this" }).click();
  await page
    .getByLabel("Store", { exact: true })
    .selectOption({ label: "H Mart Bellaire · demo listing" });
  await page.getByLabel("Date seen").fill("2026-09-01");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Thanks! Your submission is pending community moderation.",
  );
});
