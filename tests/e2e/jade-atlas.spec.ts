import { expect, test, type Page } from "@playwright/test";
import { openMapList } from "./fixtures";

// Exercise the actual Mapbox renderer without live tiles, geocoding or glyph fees.
// Deliberately request tilt in the provider style: application camera constraints win.
const providerStyle = {
  version: 8,
  pitch: 45,
  bearing: 30,
  glyphs: "https://api.mapbox.com/fonts/v1/fixture/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#eee" },
    },
  ],
};

async function mockProvider(page: Page) {
  await page.route(/(\/\/|\.)mapbox\.com\//, async (route) => {
    const url = route.request().url();
    if (url.includes("/styles/")) await route.fulfill({ json: providerStyle });
    else if (url.includes("/fonts/"))
      await route.fulfill({
        contentType: "application/x-protobuf",
        body: Buffer.alloc(0),
      });
    else await route.fulfill({ status: 200, body: "{}" });
  });
}

test("the floating list remembers its preference, closes with Escape and yields to shared links", async ({
  page,
}) => {
  await mockProvider(page);
  await page.goto("/?types=place");
  test.skip(
    await page.getByText("Map preview needs a Mapbox token.").isVisible(),
    "Requires NEXT_PUBLIC_MAPBOX_TOKEN (a fake test token is sufficient).",
  );
  const panel = page.locator("#map-panel");
  await expect(panel).toBeHidden();
  await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
  // Hidden content is out of the tab order; opening is an explicit, remembered choice.
  await openMapList(page);
  await page.reload();
  await expect(panel).toBeVisible();
  // Escape closes the panel and returns focus to the entry button.
  await panel.focus();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: /^Show list/ })).toBeFocused();
  await page.reload();
  await expect(panel).toBeHidden();
  // A shared item link opens the panel with details whatever the stored preference is.
  await openMapList(page);
  await page.locator(".result-row a").first().click();
  const shared = page.url();
  expect(shared).toMatch(/item=/);
  await page.locator(".map-list-toggle").click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(shared);
  await page.goto(shared);
  await expect(panel).toBeVisible();
  await expect(page.locator(".item-preview")).toBeVisible();
  await page
    .getByRole("button", { name: "Back to results", exact: true })
    .click();
  await expect(page).not.toHaveURL(/item=/);
  await page.locator(".result-row a").first().click();
  await page.goBack();
  await page.locator(".map-list-toggle").click();
  await expect(panel).toBeHidden();
  await page.goForward();
  await expect(panel).toBeVisible();
  await expect(page.locator(".item-preview")).toBeVisible();
});

test("flat map fills the viewport with a quiet atlas, a collapsed list and a usable mobile list", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockProvider(page);
  await page.goto("/?types=place");
  // CI normally has no token; run this provider-fixture test with an explicit fake token.
  test.skip(
    await page.getByText("Map preview needs a Mapbox token.").isVisible(),
    "Requires NEXT_PUBLIC_MAPBOX_TOKEN (a fake test token is sufficient).",
  );
  await expect(page.locator(".map-skeleton")).toHaveCount(0);
  await expect(page.locator(".map-unavailable")).toHaveCount(0);
  await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
  // A fresh session starts with the list collapsed over a full-viewport canvas.
  await expect(page.locator("#map-panel")).toBeHidden();
  const viewport = page.viewportSize()!;
  const canvasBox = await page.locator(".mapboxgl-canvas").boundingBox();
  expect(canvasBox).toMatchObject({
    width: viewport.width,
    height: viewport.height,
  });
  await openMapList(page);
  expect(await page.locator(".mapboxgl-canvas").boundingBox()).toEqual(
    canvasBox,
  );
  const first = page.locator(".result-row a").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/item=/);
  // Selection is a quiet ring and label; the companion is not mounted on the map home.
  await expect(page.locator(".map-pet-host")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to results", exact: true })
    .click();
  await expect(page.locator(".map-pet-host")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([
    { name: "locale", value: "zh-TW", url: test.info().project.use.baseURL! },
  ]);
  await page.reload();
  await expect(page.locator(".map-skeleton")).toHaveCount(0);
  await expect(page.locator(".map-unavailable")).toHaveCount(0);
  await openMapList(page);
  await expect(page.locator(".result-row").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("dark map follows the OS, honours a stored override and keeps the map usable", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockProvider(page);
  await page.goto("/?types=place");
  test.skip(
    await page.getByText("Map preview needs a Mapbox token.").isVisible(),
    "Requires NEXT_PUBLIC_MAPBOX_TOKEN (a fake test token is sufficient).",
  );
  await expect(page.locator(".map-skeleton")).toHaveCount(0);
  await expect(page.locator(".map-workspace")).toHaveAttribute(
    "data-map-theme",
    "dark",
  );
  await expect(page.locator("body")).toHaveAttribute("data-map-theme", "dark");
  await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
  // Choosing Light in the menu wins over the OS and survives a reload.
  await page.locator(".map-profile-menu summary").click();
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(page.locator(".map-workspace")).toHaveAttribute(
    "data-map-theme",
    "light",
  );
  await page.reload();
  await expect(page.locator(".map-workspace")).toHaveAttribute(
    "data-map-theme",
    "light",
  );
  await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
});
test("choosing another city moves the map to it", async ({ page }) => {
  await mockProvider(page);
  await page.goto("/");
  test.skip(
    await page.getByText("Map preview needs a Mapbox token.").isVisible(),
    "Requires NEXT_PUBLIC_MAPBOX_TOKEN (a fake test token is sufficient).",
  );
  await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
  const map = page.locator(".map-canvas");
  const select = page.getByLabel("Your city");
  // Tokyo, Taipei, then back to the starting city: the camera settles on each
  // city's center, and the picker shows the city on screen (a stale value
  // would make re-choosing the starting city fire no change at all).
  const visits = [
    ["tokyo", /^139\.6\d*,35\.6\d*,10\.5$/],
    ["taipei", /^121\.5\d*,25\.0\d*,10\.5$/],
    ["houston", /^-95\.3\d*,29\.7\d*,10\.5$/],
  ] as const;
  for (const [slug, camera] of visits) {
    await select.selectOption(slug);
    await expect(page).toHaveURL(new RegExp(`city=${slug}`));
    await expect(select).toHaveValue(slug);
    await expect(map).toHaveAttribute("data-camera", camera);
  }
});
