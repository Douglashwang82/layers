import { expect, test, type Page } from "@playwright/test";
import {
  createAndSignIn,
  openMapList,
  seededItem,
  seededPlacesMap,
} from "./fixtures";

/*
 * The map panel's shell and each screen inside it: one header, one scrolling
 * area, and a way back from every screen. Mapbox is blocked, so the panel
 * stays open as in CI (no token). The panel has no list of places: a place
 * opens from its pin, or here from a shared link.
 */
const panel = (page: Page) => page.locator("#map-panel");
const header = (page: Page) => panel(page).locator(".panel-header");
const scroller = (page: Page) => panel(page).locator(".panel-scroll");
const title = (page: Page) => header(page).getByRole("heading", { level: 2 });

async function openSeededMap(page: Page, extra = "") {
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  await page.goto(await seededPlacesMap(extra));
  await openMapList(page);
}

/** Opens a seeded place the way a shared link does. */
async function openSeededPlace(page: Page) {
  await openSeededMap(page, await seededItem("Little Taipei Noodle House"));
  await expect(page.locator(".item-preview")).toBeVisible();
}

/** Every screen has the one header; nothing else closes or goes back. */
async function expectOneHeader(page: Page) {
  await expect(header(page)).toHaveCount(1);
  await expect(panel(page).getByRole("button", { name: "Close" })).toHaveCount(
    0,
  );
}

test("layers: the panel's only list, titled in the header, with one scroller", async ({
  page,
}) => {
  await openSeededMap(page);
  await expect(title(page)).toHaveText("Your layers");
  await expectOneHeader(page);
  await expect(header(page).locator(".panel-back")).toHaveCount(0);
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
});

test("old list links and pinless places open the map, not a list", async ({
  page,
}) => {
  const map = await seededPlacesMap("&view=list");
  const slug = new URLSearchParams(map.slice(1)).get("layers")!;
  const subjectId = crypto.randomUUID();
  await page.route("**/api/v1/map/external-references?**", (route) =>
    route.fulfill({
      json: {
        data: {
          references: [
            {
              subjectId,
              canonicalKey: `subject:${subjectId}`,
              providerPlaceId: `fake-${subjectId}`,
              name: "Unpinned Google place",
              localNote: "",
              layers: [slug],
              cityReviewStatus: "approved",
              location: null,
            },
          ],
          nextCursor: null,
          totalAuthorizedReferences: 1,
        },
      },
    }),
  );
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
  await page.goto(map);
  await openMapList(page);
  await expect(title(page)).toHaveText("Your layers");
  await expect(page.locator(".view-list")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "List view" })).toHaveCount(0);
  await expect(page.getByText("Unpinned Google place")).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Seeded places/ }).uncheck();
  await expect(page).toHaveURL(/layers=none/);
  await expect(page).not.toHaveURL(/view=list/);
});

test("detail: opens at the top, back returns to Your layers", async ({
  page,
}) => {
  await openSeededPlace(page);
  await expect(
    page.locator(".item-preview").getByRole("heading", { level: 2 }),
  ).toBeVisible();
  await expectOneHeader(page);
  // The back label stands alone, since the place name leads the content.
  await expect(header(page).locator(".panel-back")).toHaveText(
    "Back to layers",
  );
  await expect(page.locator(".route-action")).toBeVisible();
  await expect
    .poll(() => scroller(page).evaluate((node) => node.scrollTop))
    .toBe(0);
  await header(page).locator(".panel-back").click();
  await expect(page).not.toHaveURL(/item=/);
  await expect(title(page)).toHaveText("Your layers");
});

test("route: planner in the shell, left by its back, Done and the Layers button", async ({
  page,
}) => {
  await openSeededPlace(page);
  await page.getByRole("button", { name: "Add to route" }).click();
  await page.getByRole("button", { name: /^Edit route/ }).click();
  await expect(title(page)).toHaveText("Your route");
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
  await expect(title(page)).toHaveText("Your layers");
  await expect(page.locator(".route-planner")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Layers \d/ }),
  ).toHaveAttribute("aria-expanded", "true");
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
  await expect(title(page)).toBeVisible();
});

test("a failed map refresh is reported on the Layers screen too", async ({
  page,
}) => {
  await openSeededMap(page);
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
  const fits = async () => {
    await expect(header(page)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    const overflow = await scroller(page).evaluate(
      (node) => node.scrollWidth - node.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  };
  await fits();
  await openSeededPlace(page);
  await fits();
});
