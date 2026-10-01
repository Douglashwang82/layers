import { expect, test } from "@playwright/test";

test("provider failure leaves list selection usable without a floating orphan companion", async ({
  page,
}) => {
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  await page.goto("/");
  await page.getByRole("link", { name: /Morning Soy Kitchen/ }).click();
  await expect(
    page.getByRole("heading", { name: "Morning Soy Kitchen", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".map-pet-host")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to results", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: /Morning Soy Kitchen/ }),
  ).toBeVisible();
});

test("V2 companion renders real geometry and all three expressions", async ({
  page,
}) => {
  await page.goto("/mascot");
  const pet = page.getByRole("button", {
    name: "Hover or focus to turn. Tap to greet.",
    exact: true,
  });
  await expect(pet).toBeVisible();
  await expect(pet).toHaveAttribute("data-pose", "front");
  await expect(pet.locator("[data-renderer='three'] canvas")).toBeVisible();
  await expect(pet.locator("svg image")).toHaveCount(0);
  await page.getByRole("button", { name: "Curious", exact: true }).click();
  await expect(pet).toHaveAttribute("data-pose", "curious");
  await page.getByRole("button", { name: "Happy blink", exact: true }).click();
  await expect(pet).toHaveAttribute("data-pose", "happy");
});

test("WebGL failure preserves the reference fallback and interaction", async ({
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
  await page.goto("/mascot");
  await expect(page.locator(".marker-pet svg image")).toHaveAttribute(
    "href",
    "/mascot/reference-v2.jpg",
  );
  await page.getByRole("button", { name: "Happy blink", exact: true }).click();
  await expect(page.locator(".marker-pet")).toHaveAttribute(
    "data-pose",
    "happy",
  );
  await expect(page.locator(".marker-pet canvas")).toHaveCount(0);
});

test("keyboard greeting plays once and returns to its resting interaction state", async ({
  page,
}) => {
  await page.goto("/mascot");
  const pet = page.locator(".marker-pet");
  // The canvas mounts from an effect, so React's focus handler is attached.
  await expect(pet.locator("[data-renderer='three'] canvas")).toBeVisible();
  await pet.focus();
  await expect(pet).toHaveAttribute("data-pose", "curious");
  // The greeting lasts 650 ms while WebGL keeps rendering, so record its state
  // when React commits it rather than racing assertion polling to catch it.
  await pet.evaluate((element) => {
    const log: string[][] = [];
    Object.assign(window, { petGreetingLog: log });
    new MutationObserver(() => {
      const body = getComputedStyle(
        element.querySelector(".marker-pet__body")!,
      );
      log.push([
        element.getAttribute("data-celebrating")!,
        body.animationName,
        body.animationIterationCount,
      ]);
    }).observe(element, { attributeFilter: ["data-celebrating"] });
  });
  await pet.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { petGreetingLog: string[][] }).petGreetingLog,
      ),
    )
    .toContainEqual(["true", "pet-success", "1"]);
  await expect(pet).toHaveAttribute("data-celebrating", "false");
  await expect(pet).toHaveAttribute("data-pose", "curious");
});

test("reduced motion and the motion toggle both keep the body still", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/mascot");
  const body = page.locator(".marker-pet__body");
  await expect(body).toHaveCSS("animation-name", "none");
  await page.locator(".marker-pet").click();
  await expect(body).toHaveCSS("animation-name", "none");
  await expect(body).toHaveCSS("transform", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("checkbox", { name: "Play gentle motion" }).uncheck();
  await expect(body).toHaveCSS("animation-name", "none");
  await expect(body).toHaveCSS("transition-duration", "0s");
});

test("Traditional Chinese mobile preview fits without horizontal scrolling", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([
    { name: "locale", value: "zh-TW", url: test.info().project.use.baseURL! },
  ]);
  await page.goto("/mascot");
  await expect(
    page.getByRole("heading", { name: "陪你探索城市的小夥伴" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "開心眨眼", exact: true }).click();
  await expect(page.locator(".marker-pet")).toHaveAttribute(
    "data-pose",
    "happy",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("tuning panel resizes and reshapes the preview, and resets", async ({
  page,
}) => {
  await page.goto("/mascot");
  const pet = page.locator(".marker-pet");
  await expect(pet.locator("[data-renderer='three'] canvas")).toBeVisible();
  const size = page.getByRole("slider", { name: "Size", exact: true });
  await size.fill("400");
  await expect(
    page.getByText("Larger than the 320 px hero guidance"),
  ).toBeVisible();
  await expect
    .poll(async () => Math.round((await pet.boundingBox())!.width))
    .toBe(400);
  await page.getByRole("slider", { name: "Eye spacing" }).fill("0.4");
  await page.getByText("Current values").click();
  await expect(page.locator(".pet-tuner__values pre")).toContainText(
    '"x": 0.4',
  );
  await expect(pet.locator("canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(size).toHaveValue("280");
  await expect(page.locator(".pet-tuner__values pre")).toContainText(
    '"x": 0.297',
  );
});
