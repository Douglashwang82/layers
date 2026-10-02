import { expect, test } from "@playwright/test";

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

test("flat map loads with atlas artwork, selection companion and a usable mobile list", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  await page.goto("/?types=place");
  // CI normally has no token; run this provider-fixture test with an explicit fake token.
  test.skip(
    await page.getByText("Map preview needs a Mapbox token.").isVisible(),
    "Requires NEXT_PUBLIC_MAPBOX_TOKEN (a fake test token is sufficient).",
  );
  await expect(page.locator(".map-skeleton")).toHaveCount(0);
  await expect(page.locator(".map-unavailable")).toHaveCount(0);
  await expect(page.locator(".mapboxgl-canvas")).toBeVisible();
  const first = page.locator(".result-row a").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/item=/);
  await expect(page.locator(".map-pet-host .marker-pet")).toBeVisible();
  await expect(
    page.locator(".map-pet-host [data-renderer='three'] canvas"),
  ).toBeVisible();
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
  await expect(page.locator(".result-row").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
