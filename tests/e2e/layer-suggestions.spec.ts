import { expect, test, type Page, type Request } from "@playwright/test";
import { pool } from "../../packages/database/src";
import {
  createTestAccount,
  deleteTestAccount,
  openMapList,
  signIn,
} from "./fixtures";

/*
 * Layer Suggestions section of the map panel (FEATURE_LAYER_SUGGESTIONS, set
 * for E2E in playwright.config.ts). The suggestions endpoint is always mocked
 * with page.route: no model call, no key, no paid request.
 */
const suffix = crypto.randomUUID().slice(0, 8);
const email = `suggest-${suffix}@example.test`;
const slugA = `e2e-suggest-a-${suffix}`;
const slugB = `e2e-suggest-b-${suffix}`;
const titleA = `Suggest A ${suffix}`;
const titleB = `Suggest B ${suffix}`;
const bothLayers = `/?layers=${slugA},${slugB}`;
const endpoint = "**/api/v1/map/suggestions**";

const tip = (n: number, layerSlug = slugA) => ({
  type: "layer_tip",
  title: `Tip title ${n}`,
  body: `Tip body ${n}`,
  layerSlug,
});
const ready = (suggestions: unknown[]) => ({
  data: { status: "ready", generatedAt: new Date().toISOString(), suggestions },
});
const none = { data: { status: "none" } };

test.beforeAll(async () => {
  const owner = await createTestAccount("Suggest Member", email);
  for (const [slug, title] of [
    [slugA, titleA],
    [slugB, titleB],
  ]) {
    // Own (non-system) layers, so the member is past the first-run starter state.
    await pool.query(
      `INSERT INTO layer(slug,title,city_id,owner_kind,owner_user_id,audience,lifecycle,review_status)
       SELECT $1,$2,id,'user',$3,'public','active','approved' FROM city WHERE slug='houston'`,
      [slug, title, owner],
    );
  }
});
test.afterAll(async () => {
  await pool.query("DELETE FROM layer WHERE slug = ANY($1)", [[slugA, slugB]]);
  await deleteTestAccount(email);
});

/** Records suggestion requests and answers them with the given handlers. */
async function mockSuggestions(
  page: Page,
  handlers: {
    get?: (n: number, url: string) => { status?: number; json: unknown };
    post?: (n: number) => {
      status?: number;
      json: unknown;
      delayMs?: number;
    };
  } = {},
) {
  const calls = { get: [] as string[], post: [] as string[] };
  await page.route(endpoint, async (route) => {
    const request = route.request();
    const method = request.method() === "POST" ? "post" : "get";
    calls[method].push(request.url());
    const handler = handlers[method];
    const reply = handler
      ? handler(calls[method].length, request.url())
      : { json: method === "get" ? none : ready([tip(1)]) };
    const delayMs = (reply as { delayMs?: number }).delayMs ?? 0;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return route.fulfill({ status: reply.status ?? 200, json: reply.json });
  });
  return calls;
}

async function openMap(page: Page, url = bothLayers) {
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  await page.goto(url);
  await openMapList(page);
}
const section = (page: Page) => page.locator(".layer-suggestions");
const status = (page: Page) => section(page).locator("[role=status]");
const generate = (page: Page) =>
  section(page).getByRole("button", { name: "Suggest next steps" });

test("signed out: no section and no suggestions request", async ({ page }) => {
  const requests: Request[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/map/suggestions")) requests.push(r);
  });
  await openMap(page);
  await expect(page.locator("#map-panel")).toBeVisible();
  // Let any (wrongly) pending effect fire before asserting absence.
  await page.waitForLoadState("networkidle");
  await expect(section(page)).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, email);
  });

  test("shows the AI disclosure and button; generating lists suggestions with a working View layer link", async ({
    page,
  }) => {
    const calls = await mockSuggestions(page, {
      post: () => ({ json: ready([tip(1), tip(2, slugB)]) }),
    });
    await openMap(page);
    await expect(
      section(page).getByRole("heading", {
        name: "Suggestions for selected layers",
      }),
    ).toBeVisible();
    await expect(section(page)).toContainText(
      "AI-generated from your selected layers",
    );
    await expect(section(page)).toContainText("sent to Anthropic");
    await expect(generate(page)).toBeVisible();
    expect(calls.post).toHaveLength(0);

    await generate(page).click();
    await expect(status(page)).toHaveText("2 suggestions ready.");
    expect(calls.post).toHaveLength(1);
    const list = section(page).getByRole("list", { name: "Suggestions" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText("Tip title 1");
    await expect(list).toContainText("Tip body 2");
    // The button is replaced by the result.
    await expect(generate(page)).toHaveCount(0);

    // In the workspace the link opens the layer's detail panel (a LayerLink).
    const link = list.getByRole("link", { name: "View layer" }).first();
    await expect(link).toHaveAttribute("href", new RegExp(`layer=${slugA}`));
    await link.click();
    await expect(page).toHaveURL(new RegExp(`layer=${slugA}`));
    await expect(page.getByText(titleA).first()).toBeVisible();
  });

  test("a cached GET result renders without any POST", async ({ page }) => {
    const calls = await mockSuggestions(page, {
      get: () => ({ json: ready([tip(1), tip(2), tip(3)]) }),
    });
    await openMap(page);
    await expect(status(page)).toHaveText("3 suggestions ready.");
    await expect(section(page).getByRole("listitem")).toHaveCount(3);
    await expect(generate(page)).toHaveCount(0);
    expect(calls.get.length).toBeGreaterThan(0);
    expect(calls.post).toHaveLength(0);
  });

  test("429 shows the try-again-later copy", async ({ page }) => {
    await mockSuggestions(page, {
      post: () => ({ status: 429, json: { error: { message: "slow down" } } }),
    });
    await openMap(page);
    await generate(page).click();
    await expect(status(page)).toHaveText(
      "You have asked for suggestions too often. Try again later.",
    );
    await expect(status(page)).toHaveClass(/error/);
    await expect(
      section(page).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  test("500 shows the error with a retry that works", async ({ page }) => {
    const calls = await mockSuggestions(page, {
      post: (n) =>
        n === 1
          ? { status: 500, json: { error: { message: "boom" } } }
          : { json: ready([tip(1)]) },
    });
    await openMap(page);
    await generate(page).click();
    await expect(status(page)).toHaveText(
      "Suggestions could not be generated. Try again.",
    );
    await section(page).getByRole("button", { name: "Try again" }).click();
    await expect(status(page)).toHaveText("1 suggestion ready.");
    await expect(section(page).getByRole("listitem")).toHaveCount(1);
    expect(calls.post).toHaveLength(2);
  });

  test("ready with an empty list shows the no-suggestions copy", async ({
    page,
  }) => {
    await mockSuggestions(page, {
      post: () => ({ json: ready([]) }),
    });
    await openMap(page);
    await generate(page).click();
    await expect(status(page)).toHaveText(
      "No suggestions for these layers right now.",
    );
    await expect(section(page).getByRole("listitem")).toHaveCount(0);
  });

  test("changing the selected layers clears the old result and refetches with the new query", async ({
    page,
  }) => {
    const calls = await mockSuggestions(page, {
      get: (_n, url) => ({
        json: url.includes(slugB) ? ready([tip(1)]) : none,
      }),
    });
    await openMap(page);
    await expect(section(page).getByRole("listitem")).toHaveCount(1);
    expect(calls.get.at(-1)).toContain(slugB);

    await page.getByRole("checkbox", { name: new RegExp(titleB) }).uncheck();
    await expect(page).toHaveURL(new RegExp(`layers=${slugA}(&|$)`));
    // The old result is gone and the new query is fetched.
    await expect(section(page).getByRole("listitem")).toHaveCount(0);
    await expect(generate(page)).toBeVisible();
    const latest = new URL(calls.get[calls.get.length - 1]);
    expect(latest.searchParams.get("layers")).toBe(slugA);
    expect(calls.get.length).toBeGreaterThan(1);
    expect(calls.post).toHaveLength(0);
  });

  test("ticking layers leaves every row where it was", async ({ page }) => {
    await mockSuggestions(page, { get: () => ({ json: none }) });
    await openMap(page);
    const titles = page.locator(".layer-rows .layer-title");
    await expect(titles.filter({ hasText: titleA })).toHaveCount(1);
    await expect(titles.filter({ hasText: titleB })).toHaveCount(1);
    const order = await titles.allTextContents();
    const box = page.locator(".layer-rows input[type=checkbox]").first();
    await box.uncheck();
    await expect(page).not.toHaveURL(new RegExp(`${slugA},${slugB}`));
    await expect(box).not.toBeChecked();
    await expect(titles).toHaveText(order);
    await box.check();
    await expect(box).toBeChecked();
    await expect(titles).toHaveText(order);
  });

  test("changing layers mid-generation never leaves Generating stuck, and returning does not show a stale result", async ({
    page,
  }) => {
    await mockSuggestions(page, {
      post: () => ({ json: ready([tip(1)]), delayMs: 1500 }),
    });
    await openMap(page);
    await generate(page).click();
    await expect(status(page)).toHaveText("Generating suggestions…");
    await page.getByRole("checkbox", { name: new RegExp(titleB) }).uncheck();
    await expect(generate(page)).toBeEnabled();
    await expect(status(page)).not.toHaveText("Generating suggestions…");
    await page.getByRole("checkbox", { name: new RegExp(titleB) }).check();
    await page.waitForTimeout(1800);
    await expect(status(page)).not.toHaveText("Generating suggestions…");
    await expect(section(page).getByRole("listitem")).toHaveCount(0);
    await expect(generate(page)).toBeEnabled();
  });

  test("collapses and expands from the aria-expanded toggle", async ({
    page,
  }) => {
    await mockSuggestions(page);
    await openMap(page);
    const toggle = section(page).getByRole("button", {
      name: "Suggestions for selected layers",
    });
    const body = section(page).locator("#layer-suggestions-body");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(body).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(body).toBeHidden();
    await expect(section(page).getByText("AI-generated")).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(body).toBeVisible();
  });

  test("keyboard: generate with Enter, results announced in a polite live region", async ({
    page,
  }) => {
    await mockSuggestions(page, {
      post: () => ({ json: ready([tip(1), tip(2)]) }),
    });
    await openMap(page);
    const live = status(page);
    await expect(live).toHaveAttribute("aria-live", "polite");
    // The live region exists before the change so the update is announced.
    await expect(live).toHaveCount(1);
    await expect(live).toHaveText("");
    const toggle = section(page).getByRole("button", {
      name: "Suggestions for selected layers",
    });
    await toggle.focus();
    await page.keyboard.press("Tab");
    await expect(generate(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(live).toHaveText("2 suggestions ready.");
    // Focus moves to the results when the pressed button goes away.
    await expect(
      section(page).getByRole("list", { name: "Suggestions" }),
    ).toBeFocused();
    // Space on the toggle collapses it.
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Result links are reachable by keyboard.
    const link = section(page)
      .getByRole("link", { name: "View layer" })
      .first();
    await link.focus();
    await expect(link).toBeFocused();
  });

  test("the button stays, disabled and focused-in-place, while generating", async ({
    page,
  }) => {
    await mockSuggestions(page, {
      post: () => ({ json: ready([tip(1)]), delayMs: 600 }),
    });
    await openMap(page);
    await generate(page).focus();
    await page.keyboard.press("Enter");
    await expect(status(page)).toHaveText("Generating suggestions…");
    await expect(generate(page)).toBeDisabled();
    await expect(status(page)).toHaveText("1 suggestion ready.");
    await expect(
      section(page).getByRole("list", { name: "Suggestions" }),
    ).toBeFocused();
  });

  test("no usable layers hides the section and records no generated event", async ({
    page,
  }) => {
    await mockSuggestions(page, {
      get: () => ({ json: { data: { status: "none", reason: "no_layers" } } }),
    });
    await openMap(page);
    await page.waitForLoadState("networkidle");
    await expect(section(page)).toHaveCount(0);
  });

  test("320px viewport has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await mockSuggestions(page, {
      post: () => ({
        json: ready([
          {
            ...tip(1),
            title: "A".repeat(60) + " unbroken-" + "x".repeat(40),
            body: "Long body text ".repeat(20),
          },
          tip(2, slugB),
        ]),
      }),
    });
    await openMap(page);
    await generate(page).click();
    await expect(status(page)).toHaveText("2 suggestions ready.");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    const overflow = await section(page).evaluate(
      (node) => node.scrollWidth - node.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const scroller = await page
      .locator("#map-panel .panel-scroll")
      .evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(scroller).toBeLessThanOrEqual(0);
  });

  test("zh-TW copy", async ({ page }) => {
    await page.context().addCookies([
      {
        name: "locale",
        value: "zh-TW",
        url: test.info().project.use.baseURL!,
      },
    ]);
    await mockSuggestions(page, {
      post: () => ({ json: ready([tip(1), tip(2)]) }),
    });
    await openMap(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
    await expect(
      section(page).getByRole("heading", { name: "所選圖層的建議" }),
    ).toBeVisible();
    await expect(section(page)).toContainText("由 AI 根據你所選的圖層產生");
    await section(page).getByRole("button", { name: "產生下一步建議" }).click();
    await expect(status(page)).toHaveText("已產生 2 則建議。");
    await expect(
      section(page).getByRole("link", { name: "查看圖層" }).first(),
    ).toBeVisible();
  });
});
