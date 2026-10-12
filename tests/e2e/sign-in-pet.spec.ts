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
  await expect(
    page.getByText("Find your people, wherever you are."),
  ).toHaveCount(0);
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

test("WebGL failure leaves plain SVG cubes and working form", async ({
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

test("standalone sign-in removes global chrome and splits 52/48", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/sign-in?next=%2Fsaved");
  await expect(page.locator(".auth-entry-brand")).toBeVisible();
  await expect(
    page.locator(".header, .bottom-nav, footer, .demo-banner"),
  ).toHaveCount(0);
  const stage = await page.locator(".auth-stage").boundingBox();
  const side = await page.locator(".auth-brand-side").boundingBox();
  expect(side!.width / stage!.width).toBeCloseTo(0.52, 2);
  const form = await page.locator(".auth-stage .form-panel").boundingBox();
  expect(form!.width).toBeLessThanOrEqual(420);
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  await expect(
    page.locator(".auth-story, .auth-subtitle, .auth-invite"),
  ).toHaveCount(0);
  await expect(
    page.getByText("Enter your member email", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send me a 6-digit code" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Request an invite" }),
  ).toHaveAttribute("href", "/join");
  await expect(
    page.getByRole("link", { name: "Explore LocalLink" }),
  ).toHaveAttribute("href", "/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Use password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await expect(page.locator(".header")).toBeVisible();
  await expect(page.locator(".auth-entry-header")).toHaveCount(0);
});

test("compact entry keeps language switching and has no mobile nav gap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await expect(
    page.locator(".header, .bottom-nav, footer, .demo-banner"),
  ).toHaveCount(0);
  expect(
    await page
      .locator("body")
      .evaluate((body) => getComputedStyle(body).paddingBottom),
  ).toBe("0px");
  await expect(
    page.locator(".auth-entry-header .language-button"),
  ).toHaveAccessibleName("Language: 繁體中文");
  await page.locator(".auth-entry-header .language-button").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(page.locator(".form-panel h1")).toHaveText("登入");
  await expect(page.locator(".auth-entry-header .language-button")).toHaveText(
    "English",
  );
  await expect(
    page.getByRole("button", { name: "寄給我 6 位數驗證碼" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("input focus holds the rolling cubes still", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator(canvas)).toHaveAttribute("data-phase", "rolling", {
    timeout: 12000,
  });
  await page.getByLabel("Email", { exact: true }).fill("member@example.com");
  await expect(page.locator(canvas)).toHaveAttribute("data-phase", "quiet");
  const held = await page.locator(canvas).getAttribute("data-frame");
  await page.waitForTimeout(1200);
  await expect(page.locator(canvas)).toHaveAttribute("data-frame", held!);
  await expect(page.locator(canvas)).toHaveAttribute("data-phase", "quiet");
  await page.locator(".auth-entry-header .language-button").focus();
  await expect(page.locator(canvas)).not.toHaveAttribute("data-frame", held!);
  await expect(page.locator(canvas)).toHaveAttribute("data-phase", "rolling");
});

test("reducing motion freezes the rolling scene immediately", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator(canvas)).toHaveAttribute("data-phase", "rolling");
  await expect(page.locator(canvas)).not.toHaveAttribute("data-frame", "0");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(canvas)).toHaveAttribute("data-frame", "0");
  await page.waitForTimeout(500);
  await expect(page.locator(canvas)).toHaveAttribute("data-frame", "0");
});
