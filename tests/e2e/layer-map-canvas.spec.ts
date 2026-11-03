import { test, expect } from "@playwright/test";
import { createAndSignIn } from "./fixtures";

for (const mobile of [false, true]) {
  test(`layer editor reuses the main map and pin center (${mobile ? "mobile" : "desktop"})`, async ({ page }, testInfo) => {
    test.skip(!process.env.NEXT_PUBLIC_MAPBOX_TOKEN, "Requires a token-shaped value; all Mapbox requests are mocked.");
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.route(/(\/\/|\.)mapbox\.com\//, async (route) => {
      if (route.request().url().includes("/styles/v1/")) await route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#e6eee8" } }] } });
      else await route.fulfill({ status: 200, json: {} });
    });
    await createAndSignIn(page, "Canvas Keeper", `layer-canvas-${mobile}-${Date.now()}@example.test`);
    await page.goto("/?layers=none&layerPanel=library&layerTab=mine");
    const workspace = page.locator(".map-workspace");
    await expect(workspace).toHaveAttribute("data-canvas", "ready", { timeout: 15000 });
    const canvas = page.locator("canvas.mapboxgl-canvas");
    await canvas.evaluate((node) => node.setAttribute("data-test-instance", "original"));
    const screen = page.locator(".layer-workspace-screen");
    await screen.getByRole("link", { name: "Create layer", exact: true }).click();
    await screen.getByLabel("Title", { exact: true }).fill("A day around town");
    await page.screenshot({ path: testInfo.outputPath("layer-create.png"), fullPage: true });
    await screen.getByRole("button", { name: "Create layer", exact: true }).click();
    await expect(page).toHaveURL(/layerPanel=contents/);
    await expect(canvas).toHaveAttribute("data-test-instance", "original");
    await screen.getByRole("button", { name: "New place", exact: true }).click();
    await screen.getByLabel("Place name").fill("Our meeting point");
    await screen.getByRole("button", { name: "Use map center", exact: true }).click();
    await expect(screen.getByText("Pin placed on the map (approximate).")).toBeVisible();
    await expect(page.locator(".pin-picker-map")).toHaveCount(0);
    await expect(canvas).toHaveCount(1);
    await screen.getByRole("button", { name: "Save place", exact: true }).click();
    await expect(screen.getByText("Place added to this layer.")).toBeVisible();
    await screen.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page).toHaveURL(/layerPanel=detail/);
    await expect(canvas).toHaveAttribute("data-test-instance", "original");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("layer-detail.png"), fullPage: true });
  });
}
