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

test("V2 companion keeps reference artwork and all three expressions", async ({
  page,
}) => {
  await page.goto("/mascot");
  const pet = page.getByRole("button", {
    name: "Hover or focus to turn. Tap to greet.",
    exact: true,
  });
  await expect(pet).toBeVisible();
  await expect(pet).toHaveAttribute("data-pose", "front");
  await expect(pet.locator("svg image")).toHaveCount(3);
  for (const art of await pet.locator("svg image").all()) {
    await expect(art).toHaveAttribute("href", "/mascot/reference-v2.jpg");
  }
  await page.getByRole("button", { name: "Curious", exact: true }).click();
  await expect(pet).toHaveAttribute("data-pose", "curious");
  await page.getByRole("button", { name: "Happy blink", exact: true }).click();
  await expect(pet).toHaveAttribute("data-pose", "happy");
});

test("keyboard greeting plays once and returns to its resting interaction state", async ({
  page,
}) => {
  await page.goto("/mascot");
  const pet = page.locator(".marker-pet");
  await pet.focus();
  await expect(pet).toHaveAttribute("data-pose", "curious");
  await pet.press("Enter");
  await expect(pet).toHaveAttribute("data-celebrating", "true");
  await expect(pet.locator(".marker-pet__body")).toHaveCSS(
    "animation-name",
    "pet-success",
  );
  await expect(pet.locator(".marker-pet__body")).toHaveCSS(
    "animation-iteration-count",
    "1",
  );
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
