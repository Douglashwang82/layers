import { expect, test } from "@playwright/test";

const pattern = ".sign-in-pattern";
const canvas = `${pattern} canvas`;

test("Three.js cube animates at 4K resolution and pause holds the frame", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator(pattern)).toHaveAttribute("data-renderer", "three");
  await expect(page.locator(canvas)).toHaveAttribute("width", "3840");
  await expect(page.locator(canvas)).toHaveAttribute("data-target-fps", "30");
  const initial = await page.locator(canvas).getAttribute("data-frame");
  await expect(page.locator(canvas)).not.toHaveAttribute(
    "data-frame",
    initial!,
  );
  const pause = page.getByRole("button", { name: "Pause animation" });
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  const held = await page.locator(canvas).getAttribute("data-frame");
  await page.waitForTimeout(1200);
  await expect(page.locator(canvas)).toHaveAttribute("data-frame", held!);
  await pause.click();
  await expect(page.locator(canvas)).not.toHaveAttribute("data-frame", held!);
  await page.getByLabel("Email", { exact: true }).fill("member@example.com");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "member@example.com",
  );
});

test("reduced motion renders a still cube, including preference changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/sign-in");
  await expect(page.locator(pattern)).toHaveAttribute("data-renderer", "three");
  const held = await page.locator(canvas).getAttribute("data-frame");
  await page.waitForTimeout(1200);
  await expect(page.locator(canvas)).toHaveAttribute("data-frame", held!);
  await expect(page.locator(`${pattern}__pause`)).toBeHidden();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(canvas)).not.toHaveAttribute("data-frame", held!);
});

test("mobile has no WebGL and resizing restores the cube", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.locator(pattern)).toBeHidden();
  await expect(page.locator(canvas)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(pattern)).toHaveAttribute("data-renderer", "three");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(canvas)).toHaveCount(0);
});

test("WebGL failure leaves a patterned SVG cube and working form", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type.startsWith("webgl")) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/sign-in");
  await expect(page.locator(`${pattern}__fallback`)).toBeVisible();
  await expect(page.locator(canvas)).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("member@example.com");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "member@example.com",
  );
});

test("context loss releases the canvas and restores the fallback", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator(pattern)).toHaveAttribute("data-renderer", "three");
  await page.locator(canvas).evaluate((element) => {
    (element as HTMLCanvasElement)
      .getContext("webgl2")!
      .getExtension("WEBGL_lose_context")!
      .loseContext();
  });
  await expect(page.locator(`${pattern}__fallback`)).toBeVisible();
  await expect(page.locator(canvas)).toHaveCount(0);
});
