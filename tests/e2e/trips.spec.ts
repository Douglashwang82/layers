import { test, expect, type Page } from "@playwright/test";
import {
  createAndSignIn,
  createTestAccount,
  signIn,
  submitSignIn,
} from "./fixtures";
import { pool } from "../../packages/database/src";
/*
 * Trip scheduler in the map panel (docs/plans/trip-scheduler-design.md): every
 * step happens on the map route, scoped to #map-panel, with no /trips pages.
 * Layers, folders and groups are made through the API; the trip flow is driven
 * through the UI. Mapbox is blocked so the list fallback is exercised.
 */
const panel = (page: Page) => page.locator("#map-panel");
const header = (page: Page) => panel(page).locator(".panel-header");
const title = (page: Page) => header(page).getByRole("heading", { level: 2 });
const save = (page: Page) => panel(page).getByTestId("trip-save");

async function blockMap(page: Page) {
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
}
/** The page is still the map route; the retired /trips pages are never visited. */
const onMapRoute = (page: Page) => new URL(page.url()).pathname === "/";

async function createLayer(page: Page, title: string, extra = {}) {
  const created = await page.request.post("/api/v1/layers", {
    data: { title, city: "houston", audience: "private", ...extra },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).data.layer as { id: string; slug: string };
}
async function addPlace(
  page: Page,
  layerId: string,
  name: string,
  pin?: { latitude: number; longitude: number },
) {
  const added = await page.request.post(`/api/v1/layers/${layerId}/places`, {
    data: { name, ...(pin ? { pin } : {}) },
  });
  expect(added.status()).toBe(201);
}
const stopNames = (day: ReturnType<Page["locator"]>) =>
  day.getByTestId("trip-stop").locator(".trip-stop-name").allTextContents();

/** Two neighborhoods about 20 km apart, plus one place without a pin. */
async function westEastLayers(page: Page, stamp: number) {
  const west = await createLayer(page, `West ${stamp}`);
  const east = await createLayer(page, `East ${stamp}`);
  for (let i = 1; i <= 3; i++) {
    await addPlace(page, west.id, `West stop ${i}`, {
      latitude: 29.72 + i * 0.003,
      longitude: -95.6,
    });
    await addPlace(page, east.id, `East stop ${i}`, {
      latitude: 29.72 + i * 0.003,
      longitude: -95.4,
    });
  }
  await addPlace(page, west.id, "Pop-up without pin");
  return { west, east };
}

async function createFromForm(
  page: Page,
  name: string,
  from: string,
  to: string,
) {
  await page.getByLabel("Trip name", { exact: true }).fill(name);
  await page.getByLabel("First day", { exact: true }).fill(from);
  await page.getByLabel("Last day", { exact: true }).fill(to);
  await page.getByRole("button", { name: "Create trip", exact: true }).click();
  await expect(page).toHaveURL(/[?&]trip=[0-9a-f-]{36}/);
  await expect(title(page)).toHaveText(name);
}

test("plan from a folder on the map, edit, save, reload, delete", async ({
  page,
}) => {
  await blockMap(page);
  const stamp = Date.now();
  await createAndSignIn(page, "Trip Planner", `trips-${stamp}@example.test`);
  const { west, east } = await westEastLayers(page, stamp);
  const folderRes = await page.request.post("/api/v1/layer-collections", {
    data: { title: `Trip folder ${stamp}`, city: "houston" },
  });
  expect(folderRes.status()).toBe(201);
  const folder = (await folderRes.json()).data as { id: string; slug: string };
  for (const layer of [west, east]) {
    const res = await page.request.post(
      `/api/v1/layer-collections/${folder.id}/layers`,
      { data: { layerId: layer.id } },
    );
    expect(res.ok()).toBe(true);
  }

  // Folder panel → Plan a trip: the new-trip flow opens in the panel, on the map.
  await page.goto(
    `/?layers=none&view=list&layerPanel=folder&folder=${folder.slug}`,
  );
  await panel(page)
    .getByRole("link", { name: "Plan a trip with this folder", exact: true })
    .click();
  await expect(page).toHaveURL(/tripPanel=new&tripFolder=/);
  expect(onMapRoute(page)).toBe(true);
  await expect(title(page)).toHaveText("New trip");
  const preview = page.getByTestId("trip-preview");
  await expect(preview).toContainText("7 places will be planned.");
  await expect(preview).toContainText("1 without a map location");
  await createFromForm(page, `Weekend ${stamp}`, "2026-12-05", "2026-12-06");
  expect(onMapRoute(page)).toBe(true);
  await expect(
    panel(page).getByText(
      "The map isn't available. Your trip still works as a list.",
    ),
  ).toBeVisible();

  // One neighborhood per day, visited end to end; the pin-less place waits.
  const days = panel(page).getByTestId("trip-day");
  await expect(days).toHaveCount(2);
  const groups = [
    (await stopNames(days.nth(0))).sort(),
    (await stopNames(days.nth(1))).sort(),
  ];
  expect(groups).toContainEqual(["West stop 1", "West stop 2", "West stop 3"]);
  expect(groups).toContainEqual(["East stop 1", "East stop 2", "East stop 3"]);
  await expect(panel(page).getByTestId("trip-unscheduled")).toContainText(
    "Pop-up without pin",
  );

  // Reload on the trip URL: the same trip, in the panel.
  await page.reload();
  await expect(title(page)).toHaveText(`Weekend ${stamp}`);
  await expect(days).toHaveCount(2);

  // Reorder by keyboard (no drag): the day becomes "Your order"; focus stays.
  const eastDay = () => days.filter({ hasText: "East stop 2" });
  const before = await stopNames(eastDay());
  const middle = before.indexOf("East stop 2");
  const down = panel(page).getByRole("button", {
    name: "Move East stop 2 down",
    exact: true,
  });
  await down.focus();
  const reordered = page.waitForResponse(
    (r) => r.url().includes("/days/") && r.request().method() === "PATCH",
  );
  await page.keyboard.press("Enter");
  expect((await reordered).status()).toBe(200);
  await expect(save(page)).toHaveText("All changes saved.");
  await expect(down).toBeFocused();
  const after = await stopNames(eastDay());
  expect(after.indexOf("East stop 2")).toBe(middle + 1);
  await expect(eastDay().getByText("Your order")).toBeVisible();
  await eastDay()
    .getByRole("button", { name: "Order by distance", exact: true })
    .click();
  await expect(eastDay().getByText("Your order")).toHaveCount(0);
  expect(await stopNames(eastDay())).toEqual(before);

  // Move a stop to the other day: only those two days change.
  const westIndex = (await days.nth(0).textContent())?.includes("West stop 1")
    ? 0
    : 1;
  await panel(page)
    .getByLabel("Move West stop 1 to", { exact: true })
    .selectOption({ label: westIndex === 0 ? "Day 2" : "Day 1" });
  await expect(days.nth(1 - westIndex).getByTestId("trip-stop")).toHaveCount(4);
  await expect(days.nth(westIndex).getByTestId("trip-stop")).toHaveCount(2);

  // Remove a stop: it is listed as removed, saved, and Undo restores it.
  await panel(page)
    .getByRole("button", { name: "Remove East stop 3 from trip", exact: true })
    .click();
  await expect(
    panel(page).getByRole("status").filter({ hasText: "Removed East stop 3." }),
  ).toBeVisible();
  await expect(save(page)).toHaveText("All changes saved.");
  await expect(
    panel(page).getByRole("heading", { name: "Removed from this trip" }),
  ).toBeVisible();
  await panel(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    panel(page).getByRole("heading", { name: "Removed from this trip" }),
  ).toHaveCount(0);

  // Re-plan all days.
  const replanned = page.waitForResponse(
    (r) => r.url().includes("/optimize") && r.request().method() === "POST",
  );
  await panel(page)
    .getByRole("button", { name: "Re-plan all days", exact: true })
    .click();
  expect((await replanned).status()).toBe(200);
  await expect(save(page)).toHaveText("All changes saved.");

  // Choosing a stop names it on the map (list-only here: no pin to show).
  await panel(page)
    .getByRole("button", { name: "Show West stop 2 on the map", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "Show West stop 2 on the map" }),
  ).toHaveAttribute("aria-pressed", "true");

  // It is listed under Trips, and deleting returns to the list.
  await header(page).getByRole("link", { name: "Trips", exact: true }).click();
  await expect(title(page)).toHaveText("Trips");
  await expect(page).toHaveURL(/tripPanel=list/);
  await panel(page)
    .getByRole("link", { name: `Open Weekend ${stamp}`, exact: true })
    .click();
  await expect(title(page)).toHaveText(`Weekend ${stamp}`);
  await panel(page)
    .getByRole("button", { name: "Delete trip", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Yes, delete", exact: true })
    .click();
  await expect(page).toHaveURL(/tripPanel=list/);
  await expect(panel(page).locator(".empty")).toContainText("No trips yet");
});

test("plan from a layer, browser back and forward walk the trip screens", async ({
  page,
}) => {
  await blockMap(page);
  const stamp = Date.now();
  await createAndSignIn(
    page,
    "Trip Layer",
    `trips-layer-${stamp}@example.test`,
  );
  const { east } = await westEastLayers(page, stamp);

  await page.goto(
    `/?layers=none&view=list&layerPanel=detail&layer=${east.slug}`,
  );
  await panel(page)
    .getByRole("link", { name: "Plan a trip with this layer", exact: true })
    .click();
  await expect(page).toHaveURL(/tripPanel=new&tripLayer=/);
  await expect(page.getByTestId("trip-preview")).toContainText(
    "3 places will be planned.",
  );
  await createFromForm(page, `Day out ${stamp}`, "2026-12-07", "2026-12-07");
  await expect(panel(page).getByTestId("trip-day")).toHaveCount(1);
  await expect(panel(page).getByTestId("trip-stop")).toHaveCount(3);

  // Trips → the list → the trip; Back and Forward restore each panel.
  await header(page).getByRole("link", { name: "Trips", exact: true }).click();
  await expect(title(page)).toHaveText("Trips");
  await panel(page)
    .getByRole("link", { name: `Open Day out ${stamp}`, exact: true })
    .click();
  await expect(title(page)).toHaveText(`Day out ${stamp}`);
  await page.goBack();
  await expect(title(page)).toHaveText("Trips");
  await page.goBack();
  await expect(title(page)).toHaveText(`Day out ${stamp}`);
  await page.goForward();
  await expect(title(page)).toHaveText("Trips");

  // Leaving the trip returns to the map, without a trip in the URL.
  await panel(page)
    .getByRole("button", { name: "Back to the map", exact: true })
    .click();
  await expect(page).not.toHaveURL(/trip/);
  expect(onMapRoute(page)).toBe(true);

  // The Trips entry in the map header opens the list from anywhere on the map.
  await page.getByRole("link", { name: "Trips", exact: true }).first().click();
  await expect(title(page)).toHaveText("Trips");
});

test("a guest is asked to sign in and returns to the same map state", async ({
  page,
}) => {
  await blockMap(page);
  const email = `trips-guest-${Date.now()}@example.test`;
  await createTestAccount("Trip Guest", email);
  await page.goto("/?layers=none&view=list&tripPanel=new&tripLayer=any");
  await expect(panel(page)).toContainText("Sign in to plan and save trips.");
  await panel(page).getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/sign-in\?next=/);
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/tripPanel=new&tripLayer=any/);
  expect(onMapRoute(page)).toBe(true);
  await expect(title(page)).toHaveText("New trip");
});

test("a group viewer gets a read-only trip; an outsider gets nothing", async ({
  page,
  browser,
  baseURL,
}) => {
  await blockMap(page);
  const stamp = Date.now();
  await createAndSignIn(page, "Trip Owner", `trips-own-${stamp}@example.test`);
  const group = await page.request.post("/api/v1/groups", {
    data: { name: `Trip crew ${stamp}`, city: "houston" },
  });
  expect(group.status()).toBe(201);
  const groupId = (await group.json()).data.group.id as string;
  const layer = await createLayer(page, `Crew picks ${stamp}`, {
    audience: "group",
    groupId,
  });
  await addPlace(page, layer.id, "Crew A", {
    latitude: 29.75,
    longitude: -95.4,
  });
  await addPlace(page, layer.id, "Crew B", {
    latitude: 29.76,
    longitude: -95.4,
  });
  const created = await page.request.post("/api/v1/trips", {
    data: {
      title: `Crew trip ${stamp}`,
      startsOn: "2026-12-10",
      endsOn: "2026-12-10",
      groupId,
      layerId: layer.id,
    },
  });
  expect(created.status()).toBe(201);
  const tripId = (await created.json()).data.trip.id as string;

  // The owner can edit.
  await page.goto(`/?layers=none&view=list&trip=${tripId}`);
  await expect(title(page)).toHaveText(`Crew trip ${stamp}`);
  await expect(
    panel(page).getByRole("button", { name: "Re-plan all days" }),
  ).toBeVisible();

  const viewerEmail = `trips-viewer-${stamp}@example.test`;
  const outsiderEmail = `trips-out-${stamp}@example.test`;
  const viewerId = await createTestAccount("Trip Viewer", viewerEmail);
  await createTestAccount("Trip Outsider", outsiderEmail);
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'viewer')",
    [groupId, viewerId],
  );

  const viewerContext = await browser.newContext({ baseURL });
  const viewer = await viewerContext.newPage();
  await blockMap(viewer);
  await signIn(viewer, viewerEmail);
  await viewer.goto(`/?layers=none&view=list&trip=${tripId}`);
  await expect(title(viewer)).toHaveText(`Crew trip ${stamp}`);
  await expect(panel(viewer)).toContainText("You can view this trip.");
  await expect(panel(viewer).getByTestId("trip-stop")).toHaveCount(2);
  for (const name of [
    "Re-plan all days",
    "Delete trip",
    "Move Crew A down",
    "Remove Crew A from trip",
  ])
    await expect(panel(viewer).getByRole("button", { name })).toHaveCount(0);
  await expect(viewer.getByLabel("Move Crew A to")).toHaveCount(0);
  // The server enforces it too.
  const denied = await viewer.request.delete(`/api/v1/trips/${tripId}`);
  expect(denied.status()).toBeGreaterThanOrEqual(403);
  await viewerContext.close();

  const outsiderContext = await browser.newContext({ baseURL });
  const outsider = await outsiderContext.newPage();
  await blockMap(outsider);
  await signIn(outsider, outsiderEmail);
  await outsider.goto(`/?layers=none&view=list&trip=${tripId}`);
  await expect(panel(outsider)).toContainText("This trip isn't available.");
  await expect(panel(outsider).getByTestId("trip-stop")).toHaveCount(0);
  await outsiderContext.close();
});

test("a failed save says so and can be retried; a stale revision reloads", async ({
  page,
}) => {
  await blockMap(page);
  const stamp = Date.now();
  await createAndSignIn(page, "Trip Saver", `trips-save-${stamp}@example.test`);
  const { east } = await westEastLayers(page, stamp);
  const created = await page.request.post("/api/v1/trips", {
    data: {
      title: `Save ${stamp}`,
      startsOn: "2026-12-07",
      endsOn: "2026-12-07",
      layerId: east.id,
    },
  });
  const tripId = (await created.json()).data.trip.id as string;
  await page.goto(`/?layers=none&view=list&trip=${tripId}`);
  await expect(panel(page).getByTestId("trip-stop")).toHaveCount(3);

  // The first attempt fails: nothing changes, the message is an alert, Try again works.
  let failed = false;
  await page.route(/\/api\/v1\/trips\/[^/]+\/stops\//, async (route) => {
    if (!failed && route.request().method() === "PATCH") {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "X", message: "Server hiccup" },
        }),
      });
    } else await route.continue();
  });
  await panel(page)
    .getByRole("button", { name: "Remove East stop 1 from trip", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText("Server hiccup");
  await expect(panel(page).getByTestId("trip-stop")).toHaveCount(3);
  await panel(page).getByRole("button", { name: "Try again" }).click();
  await expect(panel(page).getByTestId("trip-stop")).toHaveCount(2);
  await expect(save(page)).toHaveText("All changes saved.");

  // Another device changes the trip: this edit conflicts and the latest is shown.
  await page.request.patch(
    `/api/v1/trips/${tripId}/stops/${await firstStopId(page, tripId)}`,
    {
      data: {
        expectedRevision: await revisionOf(page, tripId),
        status: "removed",
      },
    },
  );
  await panel(page)
    .getByRole("button", { name: /^Remove East stop \d from trip$/ })
    .first()
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "This trip changed on another device",
  );
  await expect(panel(page).getByTestId("trip-stop")).toHaveCount(1);
});

async function revisionOf(page: Page, tripId: string) {
  const res = await page.request.get(`/api/v1/trips/${tripId}`);
  return (await res.json()).data.revision as number;
}
async function firstStopId(page: Page, tripId: string) {
  const res = await page.request.get(`/api/v1/trips/${tripId}`);
  return (await res.json()).data.days[0].stops[0].id as string;
}

test("the trip works at phone width with no sideways scrolling", async ({
  page,
}) => {
  await blockMap(page);
  await page.setViewportSize({ width: 375, height: 700 });
  const stamp = Date.now();
  await createAndSignIn(
    page,
    "Trip Phone",
    `trips-phone-${stamp}@example.test`,
  );
  const { east } = await westEastLayers(page, stamp);
  await page.goto(`/?layers=none&view=list&tripPanel=new&tripLayer=${east.id}`);
  await createFromForm(page, `Phone ${stamp}`, "2026-12-07", "2026-12-08");
  await expect(panel(page).getByTestId("trip-day")).toHaveCount(2);
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector("#map-panel .panel-scroll")!;
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      panel: scroller.scrollWidth - scroller.clientWidth,
    };
  });
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.panel).toBeLessThanOrEqual(0);
  // The row controls stay reachable by keyboard and large enough to press.
  const remove = panel(page)
    .getByRole("button", { name: /^Remove East stop \d from trip$/ })
    .first();
  await remove.scrollIntoViewIfNeeded();
  const box = (await remove.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(32);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
});

test("set where you stay, see the day start and end there, override, then clear", async ({
  page,
}) => {
  await blockMap(page);
  const stamp = Date.now();
  await createAndSignIn(page, "Trip Base", `trips-base-${stamp}@example.test`);
  const layer = await createLayer(page, `Stay ${stamp}`);
  for (let i = 1; i <= 3; i++)
    await addPlace(page, layer.id, `Sight ${i}`, {
      latitude: 29.72 + i * 0.003,
      longitude: -95.6,
    });
  // The hotel is north of every sight, so a round trip from it reverses the order.
  await addPlace(page, layer.id, "Hotel Nord", {
    latitude: 29.8,
    longitude: -95.6,
  });
  await page.goto(
    `/?layers=none&view=list&tripPanel=new&tripLayer=${layer.id}`,
  );
  await createFromForm(page, `Stay trip ${stamp}`, "2026-12-10", "2026-12-10");
  expect(onMapRoute(page)).toBe(true);
  const day = page.getByTestId("trip-day");
  await expect(day.getByTestId("trip-stop")).toHaveCount(4);

  // A place that is already a stop cannot be the base; take it out first.
  await page
    .getByRole("button", { name: "Remove Hotel Nord from trip", exact: true })
    .click();
  await expect(day.getByTestId("trip-stop")).toHaveCount(3);
  await expect(page.getByTestId("trip-day-start")).toHaveCount(0);

  // Set the base: the day starts and ends there and the order follows.
  await page
    .getByLabel("Where you stay (optional)", { exact: true })
    .selectOption({ label: "Hotel Nord" });
  await expect(page.getByTestId("trip-day-start")).toContainText(
    "From: Hotel Nord",
  );
  await expect(page.getByTestId("trip-day-end")).toContainText(
    "Back to: Hotel Nord",
  );
  await expect(page.getByTestId("trip-day-end")).toContainText(
    "straight-line to the end",
  );
  expect(await stopNames(day)).toEqual(["Sight 3", "Sight 2", "Sight 1"]);
  await expect(page.getByTestId("trip-day-total")).toContainText(
    "Straight-line total",
  );

  // This day starts at its first stop instead; the end still returns to the base.
  await day.getByTestId("trip-start-select").selectOption("open");
  await expect(page.getByTestId("trip-day-start")).toHaveCount(0);
  await expect(page.getByTestId("trip-day-end")).toContainText(
    "Back to: Hotel Nord",
  );

  // Clear it: back to an open path with nothing about the base left.
  await page
    .getByLabel("Where you stay (optional)", { exact: true })
    .selectOption({ label: "None — each day is an open path" });
  await expect(page.getByTestId("trip-day-end")).toHaveCount(0);
  await expect(page.getByTestId("trip-day-start")).toHaveCount(0);
  await expect(day.getByTestId("trip-stop")).toHaveCount(3);
  await expect(page.getByTestId("trip-day-total")).toBeVisible();
});
