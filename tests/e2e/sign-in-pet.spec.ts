import { expect, test } from "@playwright/test";

const pattern = ".sign-in-pattern";
const transforms = async (page: import("@playwright/test").Page) =>
  page
    .locator(`${pattern}__diamond`)
    .evaluateAll((tiles) =>
      tiles.map((tile) => getComputedStyle(tile).transform),
    );

test("pattern animates locally and pause holds every tile", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator(`${pattern}__tile`)).toHaveCount(16);
  const initial = await transforms(page);
  await expect.poll(() => transforms(page)).not.toEqual(initial);
  const pause = page.getByRole("button", { name: "Pause animation" });
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  const held = await transforms(page);
  await page.waitForTimeout(1000);
  expect(await transforms(page)).toEqual(held);
  await pause.click();
  await expect.poll(() => transforms(page)).not.toEqual(held);
  await page.getByLabel("Email", { exact: true }).fill("member@example.com");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "member@example.com",
  );
});

test("reduced motion keeps the reference pattern still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/sign-in");
  await expect(page.locator(pattern)).toBeVisible();
  expect(
    await page
      .locator(pattern)
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await expect(page.locator(`${pattern}__pause`)).toBeHidden();
});

test("mobile keeps the form without the decorative stage", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.locator(pattern)).toBeHidden();
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
