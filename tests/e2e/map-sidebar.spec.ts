import { expect, test, type Page } from "@playwright/test";
import { createAndSignIn, openMapList, seededPlacesMap } from "./fixtures";

/*
 * The map panel's shell and each screen inside it: one header, one scrolling
 * area, and a way back from every screen. Mapbox is blocked, so the panel is
 * the list as in CI (no token).
 */
const panel = (page: Page) => page.locator("#map-panel");
const header = (page: Page) => panel(page).locator(".panel-header");
const scroller = (page: Page) => panel(page).locator(".panel-scroll");
const firstPlace = (page: Page) => panel(page).locator(".result-row a").first();

async function openSeededMap(page: Page, extra = "") {
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  await page.goto(await seededPlacesMap(extra));
  await openMapList(page);
  await expect(firstPlace(page)).toBeVisible();
}

/** Every screen has the one header; nothing else closes or goes back. */
async function expectOneHeader(page: Page) {
  await expect(header(page)).toHaveCount(1);
  await expect(panel(page).getByRole("button", { name: "Close" })).toHaveCount(
    0,
  );
}

test("results: one header, chips, one section per layer, one scroller", async ({
  page,
}) => {
  await openSeededMap(page);
  await expect(header(page).getByRole("heading", { level: 2 })).toHaveText(
    "Results",
  );
  await expectOneHeader(page);
  await expect(page.locator(".layer-section")).toHaveCount(1);
  await expect(
    page.locator(".layer-chips").getByRole("button", { name: "Seeded places" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".result-count")).toContainText("results");
  // The list scrolls under a header and section heading that stay put.
  const box = await scroller(page).evaluate((node) => {
    node.scrollTop = 300;
    return {
      top: node.scrollTop,
      panel: node.closest("#map-panel")!.scrollTop,
    };
  });
  expect(box.top).toBeGreaterThan(0);
  expect(box.panel).toBe(0);
  const pinned = await page
    .locator(".layer-section > summary")
    .evaluate((node) => node.getBoundingClientRect().top);
  const edge = await header(page).evaluate(
    (node) => node.getBoundingClientRect().bottom,
  );
  expect(Math.abs(pinned - edge)).toBeLessThanOrEqual(1);
});

test("layers: reached from the chips, titled in the header, back to results", async ({
  page,
}) => {
  await openSeededMap(page);
  await page.getByRole("button", { name: "Manage layers" }).click();
  await expect(header(page).getByRole("heading", { level: 2 })).toHaveText(
    "Your layers",
  );
  await expect(header(page).locator(".count-pill")).toHaveText("1");
  await expect(
    page.getByRole("button", { name: /^Layers \d/ }),
  ).toHaveAttribute("aria-expanded", "true");
  const seeded = page.getByRole("checkbox", { name: /Seeded places/ });
  await expect(seeded).toBeChecked();
  await expect(
    panel(page).getByRole("link", { name: "Seeded places" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("link", { name: "Find layers" }),
  ).toBeVisible();
  await seeded.uncheck();
  await expect(page).toHaveURL(/layers=none/);
  await expect(header(page).locator(".count-pill")).toHaveText("0");
  await seeded.check();
  await expect(page).toHaveURL(/layers=e2e-seeded-places-/);
  await page
    .getByRole("button", { name: "Back to results", exact: true })
    .click();
  await expect(header(page).getByRole("heading", { level: 2 })).toHaveText(
    "Results",
  );
  await expect(firstPlace(page)).toBeVisible();
});

test("detail: opens at the top, back restores the list position", async ({
  page,
}) => {
  await openSeededMap(page);
  const row = panel(page).locator(".result-row a").nth(6);
  await row.scrollIntoViewIfNeeded();
  const saved = await scroller(page).evaluate((node) => node.scrollTop);
  expect(saved).toBeGreaterThan(0);
  await row.click();
  await expect(page).toHaveURL(/item=/);
  await expect(page.locator(".item-preview")).toBeVisible();
  await expect(
    page.locator(".item-preview").getByRole("heading", { level: 2 }),
  ).toBeVisible();
  await expectOneHeader(page);
  // The back label stands alone, since the place name leads the content.
  await expect(header(page).locator(".panel-back")).toHaveText(
    "Back to results",
  );
  await expect(page.locator(".route-action")).toBeVisible();
  await expect
    .poll(() => scroller(page).evaluate((node) => node.scrollTop))
    .toBe(0);
  await header(page).locator(".panel-back").click();
  await expect(page).not.toHaveURL(/item=/);
  await expect
    .poll(() => scroller(page).evaluate((node) => node.scrollTop))
    .toBe(saved);
});

test("route: planner in the shell, left by its back, Done and the Layers button", async ({
  page,
}) => {
  await openSeededMap(page);
  await firstPlace(page).click();
  await page.getByRole("button", { name: "Add to route" }).click();
  await page.getByRole("button", { name: /^Edit route/ }).click();
  await expect(header(page).getByRole("heading", { level: 2 })).toHaveText(
    "Your route",
  );
  await expect(page.locator(".route-stops li")).toHaveCount(1);
  // Back returns to the place the planner opened over, as Done does.
  await header(page).locator(".panel-back").click();
  await expect(page.locator(".item-preview")).toBeVisible();
  await page.getByRole("button", { name: /^Edit route/ }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".item-preview")).toBeVisible();
  // The Layers button works from the planner, and the stops stay.
  await page.getByRole("button", { name: /^Edit route/ }).click();
  await expect(page.locator(".route-planner")).toBeVisible();
  await page.getByRole("button", { name: /^Layers \d/ }).click();
  await expect(header(page).getByRole("heading", { level: 2 })).toHaveText(
    "Your layers",
  );
  await expect(page.locator(".route-planner")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Layers \d/ }),
  ).toHaveAttribute("aria-expanded", "true");
});

test("Google places share their layer's section with catalog places", async ({
  page,
}) => {
  const map = await seededPlacesMap();
  const slug = new URLSearchParams(map.slice(1)).get("layers")!;
  const place = (name: string, location: unknown) => {
    const subjectId = crypto.randomUUID();
    return {
      subjectId,
      canonicalKey: `subject:${subjectId}`,
      providerPlaceId: `fake-${subjectId}`,
      name,
      localNote: "",
      layers: [slug],
      cityReviewStatus: "approved",
      location,
    };
  };
  const references = [
    place("Pinned Google place", { lat: 29.76, lng: -95.36 }),
    place("Unpinned Google place", null),
  ];
  await page.route("**/api/v1/map/external-references?**", (route) =>
    route.fulfill({
      json: {
        data: {
          references,
          nextCursor: null,
          totalAuthorizedReferences: references.length,
        },
      },
    }),
  );
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  await page.goto(map);
  await openMapList(page);
  const sections = page.locator(".layer-section");
  await expect(sections).toHaveCount(1);
  const rows = sections.locator(".external-row");
  await expect(rows).toHaveCount(2);
  await expect(sections.locator(".result-row").first()).toBeVisible();
  await expect(sections.locator(".count-pill")).toHaveText("22");
  await expect(page.locator(".results-summary")).toContainText(
    "1 without a map location",
  );
  await expect(rows.nth(1)).toContainText("Location unavailable");
  // The whole row opens the place; its links do not.
  await rows.first().locator(".row-title").click();
  await expect(page.locator(".business-panel")).toBeVisible();
  await expect(
    page.locator(".business-panel").getByRole("heading", { level: 2 }).first(),
  ).toHaveText("Pinned Google place");
  await expect(header(page).locator(".panel-back")).toHaveText(
    "Back to results",
  );
  await header(page).locator(".panel-back").click();
  await expect(page.locator(".business-panel")).toHaveCount(0);
  await expect(rows).toHaveCount(2);
});

test("layer screens: Open in Map is the header's way back", async ({
  page,
}) => {
  await createAndSignIn(
    page,
    "Sidebar Member",
    `sidebar-${Date.now()}@example.test`,
  );
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  await page.goto("/?layers=none&layerPanel=library&layerTab=mine");
  await expect(page.locator(".layer-workspace-screen")).toBeVisible();
  await expectOneHeader(page);
  const back = header(page).locator(".panel-back");
  await expect(back).toHaveText("Open in Map");
  await back.click();
  await expect(page).not.toHaveURL(/layerPanel=/);
  await expect(page.locator(".layer-workspace-screen")).toHaveCount(0);
  await expect(header(page).getByRole("heading", { level: 2 })).toBeVisible();
});

test("a failed map refresh is reported on the Layers screen too", async ({
  page,
}) => {
  await openSeededMap(page);
  await page.getByRole("button", { name: "Manage layers" }).click();
  await page.route("**/api/v1/map?**", (route) =>
    route.fulfill({ status: 500, json: { error: { message: "Map is down" } } }),
  );
  await page.getByRole("checkbox", { name: /Seeded places/ }).uncheck();
  const notice = page.locator(".panel-notice");
  await expect(notice).toContainText("Map is down");
  await page.unroute("**/api/v1/map?**");
  await notice.getByRole("button", { name: "Try again" }).click();
  await expect(notice).toHaveCount(0);
});

test("phones: one header sizes and closes the sheet with no sideways scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSeededMap(page);
  const height = () =>
    panel(page).evaluate((node) => node.getBoundingClientRect().height);
  const half = await height();
  await header(page).getByRole("button", { name: "Expand" }).click();
  await expect.poll(height).toBeGreaterThan(half);
  await header(page)
    .getByRole("button", { name: "Make panel smaller" })
    .click();
  await expect.poll(height).toBeCloseTo(half, 0);
  for (const open of [
    () => page.getByRole("button", { name: "Manage layers" }).click(),
    () => page.getByRole("button", { name: "Back to results" }).click(),
    () => firstPlace(page).click(),
  ]) {
    await open();
    await expect(header(page)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    const overflow = await scroller(page).evaluate(
      (node) => node.scrollWidth - node.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
