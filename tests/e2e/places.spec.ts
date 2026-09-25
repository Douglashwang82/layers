import { test, expect } from "@playwright/test";
import { createAndSignIn } from "./fixtures";
/**
 * Business discovery and scoped reviews against the deterministic fake
 * provider (NEXT_PUBLIC_GOOGLE_PLACES_UI_KIT_KEY=fake, set by the Playwright
 * web server). Mocked providers cannot prove real Google compatibility or
 * billing; they prove our flow, authorization and failure handling.
 */
test("find a business, save it, review it in a group, and reopen it", async ({
  page,
}) => {
  const stamp = Date.now();
  await createAndSignIn(page, "Places Tester", `places-${stamp}@example.test`);
  // A group gives the member somewhere to publish a first review.
  const group = await page.request.post("/api/v1/groups", {
    data: { name: `Noodle Circle ${stamp}`, city: "houston" },
  });
  expect(group.ok()).toBeTruthy();
  await page.goto("/?view=list");
  await page.getByRole("button", { name: "Find a business" }).click();
  // Traditional Chinese input is accepted as typed.
  await page.getByLabel("Search for a business by name").fill("台灣牛肉麵");
  await page.getByRole("button", { name: "Select (test provider)" }).click();
  await expect(page.getByText("Search result — not saved")).toBeVisible();
  await expect(page.getByText(/Test business fake-/).first()).toBeVisible();
  await expect(page.getByText("TaiwanHub community")).toBeVisible();
  // Browsing created nothing: the lookup says unknown until an explicit save.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  // First review: stars and a comment, published only on TaiwanHub.
  await page.getByLabel("4 of 5 stars").check();
  await page.getByLabel("Comment").fill("湯頭很濃 — great broth");
  await page.getByRole("button", { name: "Publish on TaiwanHub" }).click();
  await expect(page.getByText("Review saved.")).toBeVisible();
  await expect(
    page.getByText("TaiwanHub rating: 4.0 · 1 ratings"),
  ).toBeVisible();
  // Reopen from My saves on the subject page; the review is still there.
  await page.goto("/saved");
  await expect(page.getByText("Saved businesses (1)")).toBeVisible();
  await page.getByRole("link", { name: "Open place page" }).click();
  await expect(page).toHaveURL(/\/place-subjects\/[0-9a-f-]{36}$/);
  await expect(
    page.getByText("TaiwanHub rating: 4.0 · 1 ratings"),
  ).toBeVisible();
  await page.getByRole("button", { name: "View all" }).click();
  await expect(page.getByText("湯頭很濃 — great broth")).toBeVisible();
});
test("category search submits explicitly and a guest is asked to sign in", async ({
  page,
}) => {
  await page.goto("/?view=list");
  await page.getByRole("button", { name: "Find a business" }).click();
  await page.getByLabel("Category or keywords").fill("Taiwanese restaurant");
  await page.getByRole("button", { name: "Search this area" }).click();
  const results = page.getByRole("button", { name: /Test business fake-/ });
  await expect(results).toHaveCount(3);
  await results.first().click();
  await expect(page.getByText("Search result — not saved")).toBeVisible();
  await expect(
    page.getByText("Sign in to save or review this place."),
  ).toBeVisible();
  // Closing the business returns to discovery without touching layer results.
  await page.getByRole("button", { name: "Close business details" }).click();
  await expect(page.getByLabel("Category or keywords")).toBeVisible();
});
