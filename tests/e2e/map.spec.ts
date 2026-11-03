import { test, expect, type Page } from "@playwright/test";
import {
  createTestAccount,
  openMapList,
  seededPlacesMap,
  submitSignIn,
} from "./fixtures";
/*
 * The layers-only map (docs/plans/layer-mvp-google-links-plan.md): no search,
 * filters or system layers. These specs load a public member layer holding
 * the seeded Houston places (seededPlacesMap), since a guest's map starts
 * empty.
 */
const noodleHouse = "Little Taipei Noodle House";
/** Deterministic provider failure, whether or not a Mapbox token is configured. */
async function blockMapProvider(page: Page) {
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
}
test("map home: selection with Back, list view and layer toggles", async ({
  page,
}) => {
  // The sidebar lists results only without a map, as in CI (no token).
  await blockMapProvider(page);
  const url = await seededPlacesMap();
  await page.goto(url);
  await openMapList(page);
  // The sidebar is the place list itself, with no tab bar.
  await expect(page.getByRole("tab")).toHaveCount(0);
  // Row → shared detail surface, URL state, and Back closes it to the prior results.
  await page
    .getByRole("link", { name: noodleHouse, exact: false })
    .first()
    .click();
  await expect(page).toHaveURL(/item=place%3A|item=place:/);
  await expect(
    page.getByRole("heading", { name: noodleHouse, level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Get directions/ }),
  ).toHaveAttribute("href", /google\.com\/maps/);
  await page.goBack();
  await expect(page).not.toHaveURL(/item=/);
  await expect(
    page.getByRole("heading", { name: noodleHouse, level: 2 }),
  ).toHaveCount(0);
  // Old search and filter URLs are dropped, not shown.
  await page.goto(`${url}&q=noodle&types=event&date=today`);
  await expect(page).not.toHaveURL(/q=|types=|date=/);
  // Hiding the only layer yields the explicit empty state, never a secret default.
  await openMapList(page);
  await page.getByRole("button", { name: "Manage layers" }).click();
  const seeded = page.getByRole("checkbox", { name: /Seeded places/ });
  await expect(seeded).toBeChecked();
  await seeded.uncheck();
  await expect(page).toHaveURL(/layers=none/);
  await seeded.check();
  await expect(page).toHaveURL(/layers=e2e-seeded-places-/);
  await page
    .getByRole("button", { name: "Back to results", exact: true })
    .click();
  await expect(page.locator(".result-row").first()).toBeVisible();
  // List view is URL state too.
  await page.getByRole("button", { name: "List view" }).first().click();
  await expect(page).toHaveURL(/view=list/);
  await page.getByRole("button", { name: "Map view" }).click();
  await expect(page).not.toHaveURL(/view=/);
  // System layers are never loaded, and a missing layer is reported neutrally.
  await page.goto("/?layers=discover-houston");
  await expect(page).toHaveURL(/layers=none/);
  await page.goto("/layers/private-secret-layer");
  await expect(
    page.getByText("This layer is unavailable or requires access."),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("secret");
});
test("sign-in return keeps the selected item; save and add to a layer from the preview", async ({
  page,
}) => {
  await blockMapProvider(page);
  const url = await seededPlacesMap();
  await page.goto(url);
  await openMapList(page);
  await page
    .getByRole("link", { name: noodleHouse, exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  const email = `layer-builder-${Date.now()}@example.test`;
  await createTestAccount("Layer Builder", email);
  await submitSignIn(page, email);
  // Back on the map with the same item open; the action is presented, not executed.
  await expect(page).toHaveURL(/item=place/);
  await expect(
    page.getByRole("heading", { name: noodleHouse, level: 2 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  // Saves live on /saved; there is no My saves map layer.
  await page.goto("/saved");
  await expect(page.getByRole("link", { name: "Show on map" })).toHaveCount(0);
  // Add to a layer of one's own from the map preview, then see the membership.
  const title = `Weekend plan ${Date.now()}`;
  const created = await page.request.post("/api/v1/layers", {
    data: { title, city: "houston" },
  });
  expect(created.status()).toBe(201);
  await page.goto(url);
  await openMapList(page);
  await page
    .getByRole("link", { name: noodleHouse, exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Add to layer" }).click();
  await page.locator(".picker-row", { hasText: title }).click();
  await expect(page.locator(".picker-row", { hasText: title })).toContainText(
    "Already in this layer",
  );
});
test("a failed map provider keeps results, selection and directions usable", async ({
  page,
}) => {
  await blockMapProvider(page);
  await page.goto(await seededPlacesMap());
  // The workspace explains the failure, never a blank screen. With a token the
  // blocked provider offers a retry; without one (as in CI) it names the missing
  // token instead. Either way every list flow below must keep working.
  const loadFailed = page.getByText("The map couldn’t load");
  const needsToken = page.getByText("Map preview needs a Mapbox token.");
  await expect(loadFailed.or(needsToken)).toBeVisible();
  if (await loadFailed.isVisible())
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // The list opens by itself and cannot be hidden: no empty map with a hidden list.
  await expect(page.locator("#map-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Show list/ })).toHaveCount(0);
  // Every action flow still works from the semantic list.
  const row = page.locator(".result-row", { hasText: noodleHouse });
  await expect(row).toHaveCount(1);
  await row.locator("a").first().click();
  await expect(
    page.getByRole("heading", { name: noodleHouse, level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Get directions/ }),
  ).toHaveAttribute("href", /google\.com\/maps/);
  await page.getByRole("button", { name: "List view" }).first().click();
  await expect(page).toHaveURL(/view=list/);
  // Changing the presentation keeps the selected place; return to its results explicitly.
  await page
    .getByRole("button", { name: "Back to results", exact: true })
    .click();
  await expect(page.locator(".result-row").first()).toBeVisible();
});

test("floating shell: full-viewport map, no search, labeled menu and no page scroll", async ({
  page,
}) => {
  await blockMapProvider(page);
  await page.goto(await seededPlacesMap());
  const header = page.locator(".map-header");
  await expect(page.locator(".map-workspace")).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(header.locator(".desktop-nav")).toHaveCount(0);
  const viewport = page.viewportSize()!;
  expect(await page.locator(".map-workspace").boundingBox()).toMatchObject({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(viewport.height);
  // The labeled menu reaches every destination and Escape returns focus.
  const summary = page.locator(".map-profile-menu summary");
  await expect(summary).toContainText("Menu");
  await summary.click();
  for (const name of ["Map", "Layers", "Profile"])
    await expect(
      page.locator(".map-profile-options").getByRole("link", { name }),
    ).toBeVisible();
  await expect(
    page.locator(".map-profile-options").getByRole("link", { name: "Saved" }),
  ).toHaveCount(0);
  await summary.press("Escape");
  await expect(page.locator(".map-profile-options")).toBeHidden();
  await expect(summary).toBeFocused();
  // Phones: same full-bleed map and a floating bottom navigation.
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = await page.locator(".bottom-nav").boundingBox();
  expect(nav!.x).toBeGreaterThan(0);
  expect(nav!.y + nav!.height).toBeLessThan(844);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(844);
});
