import { test, expect, type Page } from "@playwright/test";
import {
  pool,
  ensureSystemLayers,
  generateDailyPick,
} from "../../packages/database/src";
import { addDays, localDate } from "../../packages/shared/src";
import { pickDateLabel } from "../../apps/web/src/lib/daily-pick";
import { createTestAccount, deleteTestAccount, signIn } from "./fixtures";
/*
 * A throwaway city with non-demo places (the seeded Houston catalog is all
 * demo, which can never be a Daily Pick). Removed again after the run.
 */
const suffix = crypto.randomUUID().slice(0, 8);
const city = {
  id: crypto.randomUUID(),
  slug: `dp-e2e-${suffix}`,
  name: "Pick Town",
  timezone: "America/Chicago",
  latitude: 29.76,
  longitude: -95.37,
};
const layer = `daily-pick-${city.slug}`;
const placeIds = [crypto.randomUUID(), crypto.randomUUID()];
const today = localDate(new Date(), city.timezone);
const yesterday = addDays(today, -1);
const memberEmail = `dp-e2e-${suffix}@example.test`;
let pickName = "";
let pickSlug = "";
let pastName = "";
async function blockMapProvider(page: Page) {
  await page.route(/(\/\/|\.)mapbox\.com\//, (route) => route.abort());
}
/**
 * Uncaught page errors and React hydration mismatches fail the test instead of
 * only appearing in the browser console. Aborted map-provider requests are
 * expected network noise and are not collected.
 */
function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text()))
      errors.push(`console: ${message.text()}`);
  });
  return errors;
}
async function placeName(id: string | null) {
  const place = await pool.query<{ name: string; slug: string }>(
    "SELECT name,slug FROM place WHERE id=$1",
    [id],
  );
  return place.rows[0];
}
test.beforeAll(async () => {
  await pool.query(
    "INSERT INTO city(id,slug,name,region,country,timezone,latitude,longitude) VALUES($1,$2,$3,'TX','USA',$4,$5,$6)",
    [
      city.id,
      city.slug,
      city.name,
      city.timezone,
      city.latitude,
      city.longitude,
    ],
  );
  await ensureSystemLayers(pool, city);
  for (const [i, id] of placeIds.entries())
    await pool.query(
      `INSERT INTO place(id,slug,name,name_chinese,description,description_chinese,image,category,city_id,neighborhood,address,latitude,longitude,status,is_demo,source,hours)
       VALUES($1,$2,$3,$4,$5,$6,'/demo/product-1.svg',$7,$8,'Bellaire',$9,29.7,-95.5,'approved',false,'Community submission',$10)`,
      [
        id,
        `dp-e2e-${suffix}-${i}`,
        `Pick Town Place ${i}`,
        `精選測試店 ${i}`,
        "A neighborhood tea shop serving Taiwanese teas. Its published menu includes oolong selections.",
        "一間供應台灣茶的社區茶飲店。菜單包含烏龍茶。",
        i === 0 ? "Bubble Tea" : "Bakery",
        city.id,
        `${i + 1} Example St`,
        i === 0 ? "Daily 11am–9pm" : null,
      ],
    );
  // A dated history entry: yesterday's pick (fixture setup; the CLI refuses past dates).
  const past = await generateDailyPick(city, yesterday);
  pastName = (await placeName(past.placeId)).name;
  const result = await generateDailyPick(city, today);
  const place = await placeName(result.placeId);
  pickName = place.name;
  pickSlug = place.slug;
  await createTestAccount("Pick Saver", memberEmail);
});
test.afterAll(async () => {
  await deleteTestAccount(memberEmail);
  await pool.query("DELETE FROM daily_pick WHERE city_id=$1", [city.id]);
  await pool.query("DELETE FROM layer WHERE city_id=$1", [city.id]);
  await pool.query("DELETE FROM place WHERE city_id=$1", [city.id]);
  await pool.query("DELETE FROM city WHERE id=$1", [city.id]);
});
test("daily pick: card, map selection, filtered state and history", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await blockMapProvider(page);
  await page.goto(`/?city=${city.slug}&layers=${layer}`);
  const card = page.getByRole("region", { name: "Daily Pick" });
  await expect(card.getByText(pickDateLabel(today, "en"))).toBeVisible();
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: pickName })).toBeVisible();
  await expect(card.getByText("About this place")).toBeVisible();
  await expect(card.getByText("Why we picked it")).toBeVisible();
  await expect(card.getByText("hasn't been a Daily Pick before")).toBeVisible();
  await expect(card.getByText(/doesn't mean it's open today/)).toBeVisible();
  await expect(card.getByRole("link", { name: "View place" })).toHaveAttribute(
    "href",
    `/places/${pickSlug}`,
  );
  await expect(
    card.getByRole("link", { name: /Get directions/ }),
  ).toHaveAttribute("href", /google\.com\/maps/);
  // Map/list agreement: the same place is the only result row.
  await expect(page.locator(".result-row")).toHaveCount(1);
  await expect(page.locator(".result-row")).toContainText(pickName);
  // Keyboard: "Show on map" selects the same item as the pin and row.
  await card.getByRole("button", { name: "Show on map" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/item=place%3A|item=place:/);
  await expect(
    page.getByRole("heading", { name: pickName, level: 2 }),
  ).toBeVisible();
  // Outside the map area: explained, with a way back to the pick; never a substitute.
  await page.goto(
    `/?city=${city.slug}&layers=${layer}&area=-80.50000,40.10000,-80.10000,40.40000`,
  );
  await expect(card.getByText(/outside the current map area/)).toBeVisible();
  await expect(page.locator(".result-row")).toHaveCount(0);
  await card.getByRole("button", { name: "Show today's pick" }).click();
  await expect(page).not.toHaveURL(/area=/);
  await expect(page).toHaveURL(/item=place/);
  await expect(
    page.getByRole("heading", { name: pickName, level: 2 }),
  ).toBeVisible();
  // Dated history.
  await page.goto(`/daily-pick?city=${city.slug}`);
  await expect(
    page.getByRole("heading", { name: `Daily Pick · ${city.name}`, level: 1 }),
  ).toBeVisible();
  const history = page.getByRole("region", { name: "Previous picks" });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expect(history.getByRole("link", { name: pastName })).toBeVisible();
  await expect(history.getByText(pickDateLabel(yesterday, "en"))).toBeVisible();
  await expect(history.getByText(/Why we picked it/)).toBeVisible();
  expect(errors).toEqual([]);
});
test("daily pick: Traditional Chinese on a mobile layout", async ({
  page,
  context,
}) => {
  const errors = collectPageErrors(page);
  await blockMapProvider(page);
  await context.addCookies([
    { name: "locale", value: "zh-TW", url: "http://localhost" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?city=${city.slug}&layers=${layer}&view=list`);
  const card = page.getByRole("region", { name: "每日精選" });
  await expect(card).toBeVisible();
  await expect(card.getByText("為什麼選它")).toBeVisible();
  await expect(card.getByText("這是它第一次成為每日精選。")).toBeVisible();
  await expect(card.getByRole("link", { name: "查看地點" })).toBeVisible();
  const box = await card.boundingBox();
  expect(box && box.width <= 390).toBe(true);
  // The zh-TW date label must hydrate identically (Intl spacing differs by engine).
  await expect(card.getByText(pickDateLabel(today, "zh-TW"))).toBeVisible();
  await page.goto(`/daily-pick?city=${city.slug}`);
  const history = page.getByRole("region", { name: "過去的精選" });
  await expect(history.getByRole("link", { name: /精選測試店/ })).toBeVisible();
  await expect(
    history.getByText(pickDateLabel(yesterday, "zh-TW")),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("daily pick: saving from the card and the detail stay in agreement", async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await blockMapProvider(page);
  await signIn(page, memberEmail);
  await page.goto(`/?city=${city.slug}&layers=${layer}`);
  const card = page.getByRole("region", { name: "Daily Pick" });
  await card.getByRole("button", { name: "Show on map" }).click();
  const detail = page.locator(".item-preview");
  await expect(
    detail.getByRole("heading", { name: pickName, level: 2 }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  // Card → detail.
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Saved", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    detail.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  // Detail → card.
  await detail.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(
    detail.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Save", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  // Authoritative state survives a reload.
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Daily Pick" })
      .getByRole("button", { name: "Save", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});
