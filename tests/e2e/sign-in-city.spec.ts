import { expect, test } from "@playwright/test";

// Count real WebGL submissions without adding diagnostic state to the product.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { cityDraws: number };
    state.cityDraws = 0;
    const original = WebGL2RenderingContext.prototype.drawElementsInstanced;
    WebGL2RenderingContext.prototype.drawElementsInstanced = function (
      ...args
    ) {
      state.cityDraws++;
      return original.apply(this, args);
    };
  });
});
async function draws(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => (window as typeof window & { cityDraws: number }).cityDraws,
  );
}

test("city renders, pauses for the form, and leaves responsive sign-in usable", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator('.sign-in-city[data-ready="true"]')).toBeVisible();
  await expect(page.locator(".auth-scene")).not.toContainText("台");
  const before = await draws(page);
  await expect.poll(() => draws(page)).toBeGreaterThan(before);
  await page.locator("#auth-code-email").fill("member@example.com");
  const focused = await draws(page);
  await page.waitForTimeout(250);
  expect(await draws(page)).toBe(focused);
  await page.getByRole("button", { name: "Use password instead" }).click();
  await expect(page.locator("#auth-password")).toBeVisible();
  for (const width of [1440, 1024, 820]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(page.locator("#auth-password")).toBeVisible();
  }
});

test("mobile skips WebGL and desktop resizing disposes and recreates one canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await expect(page.locator("#auth-code-email")).toBeVisible();
  await expect(page.locator(".sign-in-city-canvas")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  for (let i = 0; i < 2; i++) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator(".sign-in-city-canvas")).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".sign-in-city-canvas")).toHaveCount(0);
  }
});

test("reduced motion draws a still city and responds to preference changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/sign-in");
  await expect(page.locator('.sign-in-city[data-ready="true"]')).toBeVisible();
  await page.waitForTimeout(250);
  const still = await draws(page);
  await page.waitForTimeout(250);
  expect(await draws(page)).toBe(still);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => draws(page)).toBeGreaterThan(still);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(250);
  const stopped = await draws(page);
  await page.waitForTimeout(250);
  expect(await draws(page)).toBe(stopped);
});

test("WebGL failure keeps the illustration and form available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]).startsWith("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/sign-in");
  await expect(page.locator(".sign-in-city-fallback")).toBeVisible();
  await expect(page.locator(".sign-in-city-canvas")).toHaveCount(0);
  await page.locator("#auth-code-email").fill("member@example.com");
  await page.getByRole("button", { name: "Use password instead" }).click();
  await expect(page.locator("#auth-password")).toBeVisible();
});

test("context loss restores the static city without affecting sign-in", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator('.sign-in-city[data-ready="true"]')).toBeVisible();
  await page
    .locator(".sign-in-city-canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      canvas
        .getContext("webgl2")!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });
  await expect(page.locator(".sign-in-city-canvas")).toHaveCount(0);
  await expect(page.locator(".sign-in-city-fallback")).toBeVisible();
  await expect(page.locator("#auth-code-email")).toBeVisible();
});
