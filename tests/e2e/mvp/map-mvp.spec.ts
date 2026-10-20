import { test, expect } from "@playwright/test";
import { createAndSignIn, openMapList } from "../fixtures";
/*
 * Map MVP (docs/plans/layer-mvp-google-links-plan.md), run by
 * playwright.mvp.config.ts with FEATURE_MAP_MVP on and the fake Google link
 * resolver and Places provider: no search, no system layers, layers built
 * from Google Maps links, and events attached to their places.
 */
test("a signed-out visitor sees an empty map without search", async ({
  page,
}) => {
  await page.goto("/");
  await openMapList(page);
  await expect(
    page.getByRole("heading", { name: "Put your places on the map" }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(
    page.locator("#map-panel").getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  // A system layer link loads nothing and reports nothing.
  await page.goto("/?layers=discover-houston&q=noodles&scope=city");
  await expect(page).toHaveURL(/\/\?layers=none$/);
  await openMapList(page);
  await expect(
    page.getByRole("heading", { name: "Put your places on the map" }),
  ).toBeVisible();
  await expect(page.getByText("Layer unavailable")).toHaveCount(0);
});
test("a member builds a layer from Google Maps links and attaches an event", async ({
  page,
}) => {
  await createAndSignIn(
    page,
    "Link Collector",
    `map-mvp-${Date.now()}@example.test`,
  );
  // The empty map points at creating a layer from Google Maps.
  await openMapList(page);
  await expect(
    page.getByRole("heading", { name: "Your layers" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Create a layer from Google Maps" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Create a layer from Google Maps" }),
  ).toBeVisible();
  const title = `Weekend eats ${Date.now()}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Google Maps links")
    .fill(
      [
        "https://www.google.com/maps/place/Tiger+Den/@29.7052,-95.5523,17z",
        "Kim Son https://maps.google.com/?q=Kim+Son+Restaurant",
        "https://www.google.com/maps/placelists/list/abc",
        "https://maps.google.com/?q=Kim+Son+Restaurant",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Check links" }).click();
  await expect(page.getByText("2 places found")).toBeVisible();
  await expect(
    page.getByText(/Google Maps lists aren't supported/),
  ).toBeVisible();
  await expect(page.getByText("Same place as an earlier link.")).toBeVisible();
  await expect(page.getByText("From the link: Tiger Den")).toBeVisible();
  await page
    .getByRole("button", { name: "Create layer with 2 places" })
    .click();
  await expect(page).toHaveURL(/\/\?layers=weekend-eats-/);
  const slug = new URL(page.url()).searchParams.get("layers")!;
  // The map shows the layer's places, and there is still no search.
  await openMapList(page);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  const places = page.locator(".mvp-places .external-references li");
  await expect(places).toHaveCount(2);
  await expect(places.first()).toContainText("Test business fake-link-");
  await page.getByRole("tab", { name: /Layers/ }).click();
  await expect(
    page.getByRole("checkbox", { name: new RegExp(title) }),
  ).toBeChecked();
  // Edit: add another place from a link and an event at the first place.
  await page.goto(`/layers/${slug}/edit`);
  const googlePlaces = page.locator(".google-places > li");
  await expect(googlePlaces).toHaveCount(2);
  await page
    .getByLabel("Google Maps links")
    .fill("https://maps.google.com/?q=Boba+Corner");
  await page.getByRole("button", { name: "Check links" }).click();
  await page.getByRole("button", { name: "Add 1 places" }).click();
  await expect(page.getByText("1 places added.")).toBeVisible();
  await expect(googlePlaces).toHaveCount(3);
  const first = googlePlaces.first();
  await first.locator("summary", { hasText: "Events" }).click();
  await first.getByRole("button", { name: "Add event" }).click();
  await first.getByLabel("Event name").fill("Night market");
  await first.getByLabel("Starts").fill("2099-11-07T18:00");
  await first.getByLabel("Ends").fill("2099-11-07T22:00");
  await first.getByRole("button", { name: "Save event" }).click();
  await expect(first.getByText("Event saved.")).toBeVisible();
  await expect(first.getByText("Night market")).toBeVisible();
  await expect(first).toContainText("6:00");
  // Back on the map, the place carries its upcoming event.
  await page.goto(`/?layers=${slug}`);
  await openMapList(page);
  await expect(places).toHaveCount(3);
  await expect(places.first()).toContainText("Night market");
});
