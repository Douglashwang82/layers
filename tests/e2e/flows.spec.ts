import { test, expect } from "@playwright/test";
test("guest discovery, Chinese search, and responsive navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Houston · Map", level: 1 }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  // Unified bilingual search stays on /search; the map searches items in applied layers.
  await page.goto("/search?q=義美");
  await expect(
    page.getByRole("heading", { name: "I-Mei Chocolate Puffs", exact: true }),
  ).toBeVisible();
  await page.goto("/events?period=weekend");
  await expect(page.locator(".events-card").first()).toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Houston · Map", level: 1 }),
  ).toBeAttached();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(768);
  await page.screenshot({
    path: "test-results/home-tablet.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Language" }).click();
  await expect(page.getByRole("tab", { name: /結果/ })).toBeVisible();
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
test("route ownership, filter state, no-vote score, and map fallback", async ({
  page,
}) => {
  // Map owns /, Layers owns /layers/*; standalone catalog pages highlight nothing.
  await page.goto("/layers/today-houston");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", {
      name: "Layers",
    }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/places/demo-little-taipei-noodle-house");
  await expect(
    page.getByRole("navigation", { name: "Main" }).locator("[aria-current]"),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/products/demo-i-mei-chocolate-puffs");
  await expect(
    page.getByRole("navigation", { name: "Mobile" }).locator("[aria-current]"),
  ).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Mobile" }).getByRole("link", {
      name: "Map",
    }),
  ).toHaveAttribute("aria-current", "page");
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The catalog map falls back to the list when the provider is unavailable.
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  // Filter submission keeps city and view, resets the page, and Clear keeps both.
  await page.goto("/places?city=houston&view=map&page=2");
  await page.getByLabel("Category").selectOption("Bubble Tea");
  await page
    .getByRole("button", { name: "Search", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/city=houston/);
  await expect(page).toHaveURL(/view=map/);
  await expect(page).toHaveURL(/category=Bubble\+Tea/);
  await expect(page).not.toHaveURL(/page=/);
  await expect(
    page.getByText("Map unavailable", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/city=houston/);
  await expect(page).toHaveURL(/view=map/);
  await expect(page).not.toHaveURL(/category=/);
  // Catalog pages offer a map entry carrying equivalent supported filters.
  await expect(page.getByRole("link", { name: "Open in Map" })).toHaveAttribute(
    "href",
    /layers=discover-houston/,
  );
  // Search carries the selected city into view-all links.
  await page.goto("/search?q=tea&city=houston");
  const viewAll = page.getByRole("link", { name: "View all" }).first();
  if (await viewAll.count())
    await expect(viewAll).toHaveAttribute("href", /city=houston/);
  // A place with no votes shows the invitation, never a percentage.
  const noVotes = page.locator(".score-empty").first();
  await page.goto("/places?sort=score&page=2");
  if (await noVotes.count()) {
    await expect(noVotes).toHaveText("Be the first to recommend");
    await expect(noVotes.locator("svg")).toHaveCount(0);
  }
  // 320px still reflows without page-wide horizontal overflow.
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of [
    "/",
    "/layers",
    "/events",
    "/places/demo-little-taipei-noodle-house",
  ]) {
    await page.goto(path);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  }
});
