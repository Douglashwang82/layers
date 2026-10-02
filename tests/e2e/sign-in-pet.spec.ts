import { expect, test } from "@playwright/test";

const stage = ".sign-in-pet";

test("desktop pet reacts to focus, errors and a sent code without blocking sign-in", async ({
  page,
}) => {
  // Stub the code request so the success path needs no mail delivery.
  await page.route(/\/api\/auth\/email-otp\/send-verification-otp/, (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sign-in");
  const pet = page.locator(stage);
  await expect(pet.locator("[data-renderer='three'] canvas")).toBeVisible();
  await expect(pet).toHaveAttribute("data-pose", "hero");
  const email = page.getByLabel("Email", { exact: true });
  await email.focus();
  await expect(pet).toHaveAttribute("data-pose", "curious");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.locator(".form-panel [role=alert]")).toBeVisible();
  await expect(pet).toHaveAttribute("data-pose", "front");
  await email.fill("member@example.com");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.locator(".form-panel [role=status]")).toBeVisible();
  await expect(pet).toHaveAttribute("data-pose", "happy");
  // The greeting is one-shot; focus has moved to the code field.
  await expect(pet).toHaveAttribute("data-pose", "curious");
  await expect(page.locator("canvas")).toHaveCount(1);
});

test("idle loop cycles expressions with brief marks until paused", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sign-in");
  const pet = page.locator(stage);
  await expect(pet.locator("[data-renderer='three'] canvas")).toBeVisible();
  // Record every pose and mark as React commits them, so short-lived states
  // are not missed while WebGL keeps the main thread busy.
  await pet.evaluate((element) => {
    const log: string[] = [];
    Object.assign(window, { petLog: log });
    new MutationObserver(() => {
      const mark = element.querySelector(".sign-in-pet__mark");
      log.push(
        `${element.getAttribute("data-pose")}:${mark?.getAttribute("data-mark") ?? "-"}`,
      );
    }).observe(element, {
      attributes: true,
      attributeFilter: ["data-pose"],
      childList: true,
    });
  });
  const log = () =>
    page.evaluate(() => (window as unknown as { petLog: string[] }).petLog);
  // Without any interaction the loop reaches the happy expression with its
  // sparkle, and that mark is later removed again.
  await expect.poll(log, { timeout: 15_000 }).toContainEqual("happy:sparkle");
  await expect.poll(log, { timeout: 15_000 }).toContainEqual("happy:-");
  const pause = page.getByRole("button", { name: "Pause animation" });
  await expect(pause).toHaveAttribute("aria-pressed", "false");
  await pause.click();
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  const held = await pet.getAttribute("data-pose");
  await page.waitForTimeout(5_000);
  await expect(pet).toHaveAttribute("data-pose", held!);
});

test("mobile shows only the form and never loads WebGL", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.locator(stage)).toBeHidden();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".sign-in-pet__pause")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("reduced motion keeps the stage still while poses still respond", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sign-in");
  const pet = page.locator(stage);
  await expect(pet.locator("[data-renderer='three'] canvas")).toBeVisible();
  expect(
    await pet.evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
  await page.getByLabel("Email", { exact: true }).focus();
  await expect(pet).toHaveAttribute("data-pose", "curious");
  // No auto-playing loop, so no pause control and no marks.
  await expect(page.locator(".sign-in-pet__pause")).toHaveCount(0);
  await expect(page.locator(".sign-in-pet__mark")).toHaveCount(0);
});

test("WebGL failure keeps the V2 artwork and a working form", async ({
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sign-in");
  await expect(page.locator(`${stage} svg image`)).toHaveAttribute(
    "href",
    "/mascot/reference-v2.jpg",
  );
  await expect(page.locator("canvas")).toHaveCount(0);
  const email = page.getByLabel("Email", { exact: true });
  await email.fill("member@example.com");
  await expect(email).toHaveValue("member@example.com");
});
