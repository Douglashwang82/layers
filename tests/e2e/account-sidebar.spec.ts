import { expect, test, type Page } from "@playwright/test";
import {
  createAndSignIn,
  deleteTestAccount,
  openMapList,
  seededPlacesMap,
} from "./fixtures";

/*
 * The account sidebar (`?account=1`) is the map's profile: it floats on the
 * right beside the left panel and replaces the /profile page. Mapbox is
 * blocked, as in CI.
 */
const email = `account-sidebar-${Date.now()}@example.test`;
const sidebar = (page: Page) => page.locator("#map-account-panel");

async function openMap(page: Page) {
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  await page.goto(await seededPlacesMap());
  await openMapList(page);
}

test.afterAll(async () => {
  await deleteTestAccount(email);
});

test("signed in: the menu opens the account sidebar beside the panel", async ({
  page,
}) => {
  await createAndSignIn(page, "Sidebar Tester", email);
  await openMap(page);
  const summary = page.locator(".map-profile-menu summary");
  await summary.click();
  await page
    .locator(".map-profile-options")
    .getByRole("link", { name: "Profile" })
    .click();
  await expect(page).toHaveURL(/account=1/);
  await expect(page).toHaveURL(/layers=/);
  await expect(sidebar(page)).toBeVisible();
  await expect(
    sidebar(page).getByRole("heading", { name: "Your account" }),
  ).toBeFocused();
  // The left panel stays open, and the two do not overlap.
  await expect(page.locator("#map-panel")).toBeVisible();
  const left = (await page.locator("#map-panel").boundingBox())!;
  const right = (await sidebar(page).boundingBox())!;
  expect(left.x + left.width).toBeLessThan(right.x);
  // The settings form saves in place.
  await sidebar(page).getByLabel("Short bio").fill("Hello from the map");
  await sidebar(page).getByRole("button", { name: "Save changes" }).click();
  await expect(sidebar(page).getByText("Profile updated.")).toBeVisible();
  await expect(
    sidebar(page).getByRole("link", { name: /contributions/i }),
  ).toBeVisible();
  // Your layers opens the library in the left panel, keeping the map state
  // and the sidebar on desktop.
  await sidebar(page).getByRole("link", { name: "Layers" }).click();
  await expect(page).toHaveURL(/layerPanel=library/);
  await expect(page).toHaveURL(/layers=/);
  await expect(sidebar(page)).toBeVisible();
  // Escape closes it, keeps the map state and returns focus to the menu.
  await sidebar(page).getByRole("heading", { name: "Your account" }).focus();
  await page.keyboard.press("Escape");
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/account=/);
  await expect(page).toHaveURL(/layers=/);
  await expect(summary).toBeFocused();
  // /profile now lands on the map with the sidebar open.
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/\?account=1$/);
  await expect(sidebar(page)).toBeVisible();
  await expect(sidebar(page).getByLabel("Short bio")).toHaveValue(
    "Hello from the map",
  );
  // Phones: a sheet spanning the width between the header and the navigation.
  await page.setViewportSize({ width: 390, height: 844 });
  const sheet = (await sidebar(page).boundingBox())!;
  expect(sheet.x).toBeGreaterThan(0);
  expect(sheet.width).toBeGreaterThan(340);
  const nav = (await page.locator(".bottom-nav").boundingBox())!;
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(nav.y);
  // Layers from the phone navigation closes the sheet it would open under.
  await page
    .locator(".bottom-nav")
    .getByRole("link", { name: "Layers" })
    .click();
  await expect(page).toHaveURL(/layerPanel=library/);
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page.locator("#map-panel")).toBeVisible();
});

test("signed out: the sidebar asks the visitor to sign in", async ({
  page,
}) => {
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  await page.goto("/?account=1");
  await expect(sidebar(page)).toBeVisible();
  const signIn = sidebar(page).getByRole("link", { name: "Sign in" });
  await expect(signIn).toHaveAttribute(
    "href",
    /^\/sign-in\?next=%2F%3Faccount%3D1/,
  );
  await sidebar(page)
    .getByRole("button", { name: "Close account panel" })
    .click();
  await expect(sidebar(page)).toHaveCount(0);
});
