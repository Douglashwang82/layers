import { test, expect, type Page } from "@playwright/test";
import { createAndSignIn } from "./fixtures";
/*
 * Trip scheduler (docs/plans/trip-scheduler-design.md): plan a trip from a
 * folder and from a layer, then remove a stop and see that day re-ordered.
 * Layers and the folder are made through the API; the trip flow is driven
 * through the UI. Mapbox is blocked so the list fallback is exercised.
 */
async function createLayer(page: Page, title: string) {
  const created = await page.request.post("/api/v1/layers", {
    data: { title, city: "houston", audience: "private" },
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

test("plan a trip from a folder, remove a stop, undo; plan from a layer", async ({
  page,
}) => {
  await page.route(/mapbox\.com\//, (route) => route.abort());
  const stamp = Date.now();
  await createAndSignIn(page, "Trip Planner", `trips-${stamp}@example.test`);
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

  // Folder → Plan a trip.
  await page.goto(
    `/?layers=none&view=list&layerPanel=folder&folder=${folder.slug}`,
  );
  await page
    .getByRole("link", { name: "Plan a trip with this folder", exact: true })
    .click();
  await expect(page).toHaveURL(/\/trips\/new\?folder=/);
  const preview = page.getByTestId("trip-preview");
  await expect(preview).toContainText("7 places will be planned.");
  await expect(preview).toContainText("1 without a map location");
  await page.getByLabel("Trip name", { exact: true }).fill(`Weekend ${stamp}`);
  await page.getByLabel("First day", { exact: true }).fill("2026-12-05");
  await page.getByLabel("Last day", { exact: true }).fill("2026-12-06");
  await page.getByRole("button", { name: "Create trip", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: `Weekend ${stamp}` }),
  ).toBeVisible();
  await expect(
    page.getByText("The map isn't available. Your trip still works as a list."),
  ).toBeVisible();

  // One neighborhood per day, visited end to end; the pin-less place waits.
  const days = page.getByTestId("trip-day");
  await expect(days).toHaveCount(2);
  const groups = [
    (await stopNames(days.nth(0))).sort(),
    (await stopNames(days.nth(1))).sort(),
  ];
  expect(groups).toContainEqual(["West stop 1", "West stop 2", "West stop 3"]);
  expect(groups).toContainEqual(["East stop 1", "East stop 2", "East stop 3"]);
  for (const i of [0, 1])
    expect((await stopNames(days.nth(i)))[1]).toMatch(/stop 2$/);
  await expect(page.getByTestId("trip-unscheduled")).toContainText(
    "Pop-up without pin",
  );
  await expect(page.getByTestId("trip-day-total")).toHaveCount(2);

  // Remove the middle west stop: only that day changes; Undo restores it.
  const westDay = days.filter({ hasText: "West stop 2" });
  const eastDay = days.filter({ hasText: "East stop 2" });
  const eastBefore = await stopNames(eastDay);
  await page
    .getByRole("button", { name: "Remove West stop 2 from trip", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Removed West stop 2." }),
  ).toBeVisible();
  const westAfter = days.filter({ hasText: "West stop 1" });
  await expect(westAfter.getByTestId("trip-stop")).toHaveCount(2);
  expect((await stopNames(westAfter)).sort()).toEqual([
    "West stop 1",
    "West stop 3",
  ]);
  expect(await stopNames(eastDay)).toEqual(eastBefore);
  await expect(
    page.getByRole("heading", { name: "Removed from this trip" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(westDay.getByTestId("trip-stop")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "Removed from this trip" }),
  ).toHaveCount(0);

  // The trip is listed.
  await page.goto("/trips");
  await expect(
    page.getByRole("link", { name: `Weekend ${stamp}` }),
  ).toBeVisible();

  // Layer → Plan a trip (single day).
  await page.goto(
    `/?layers=none&view=list&layerPanel=detail&layer=${east.slug}`,
  );
  await page
    .getByRole("link", { name: "Plan a trip with this layer", exact: true })
    .click();
  await expect(page).toHaveURL(/\/trips\/new\?layer=/);
  await expect(page.getByTestId("trip-preview")).toContainText(
    "3 places will be planned.",
  );
  await page.getByLabel("First day", { exact: true }).fill("2026-12-07");
  await page.getByLabel("Last day", { exact: true }).fill("2026-12-07");
  await page.getByRole("button", { name: "Create trip", exact: true }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("trip-day")).toHaveCount(1);
  await expect(page.getByTestId("trip-stop")).toHaveCount(3);
});
