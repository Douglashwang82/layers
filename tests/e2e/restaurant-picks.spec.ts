import { test, expect } from "@playwright/test";
import {
  pool,
  ensureSystemLayers,
  loadRestaurantArea,
  createFakeQualificationAdapter,
  createFakeCopyAdapter,
  workRestaurantJob,
  type RestaurantArea,
} from "../../packages/database/src";
import { localDate } from "../../packages/shared/src";
import { createTestAccount, deleteTestAccount, signIn } from "./fixtures";

const suffix = crypto.randomUUID().slice(0, 8);
const city = {
  id: crypto.randomUUID(),
  slug: `restaurant-e2e-${suffix}`,
  name: "Restaurant Test City",
  timezone: "America/Chicago",
};
const email = `restaurant-${suffix}@example.test`;
const today = localDate(new Date(), city.timezone);
const providerId = `fake-restaurant-${suffix}`;
let area: RestaurantArea;
let actorId: string;
let subjectId: string;
const adapters = {
  copy: createFakeCopyAdapter(),
  qualification: createFakeQualificationAdapter(
    new Map([
      [
        providerId,
        {
          rating: 4.8,
          ratingCount: 200,
          businessStatus: "OPERATIONAL",
          hoursByDate: new Map([
            [today, { date: today, periods: [{ open: 0, close: 1440 }] }],
          ]),
        },
      ],
    ]),
  ),
};
test.beforeAll(async () => {
  actorId = await createTestAccount("Restaurant reviewer", email, "ADMIN");
  await pool.query(
    `INSERT INTO city(id,slug,name,region,country,timezone,latitude,longitude) VALUES($1,$2,$3,'TX','USA',$4,29.76,-95.37)`,
    [city.id, city.slug, city.name, city.timezone],
  );
  await ensureSystemLayers(pool, city);
  await pool.query(
    `INSERT INTO restaurant_discovery_area(city_slug,layer_slug,timezone,enabled) VALUES($1,$2,$3,true)`,
    [city.slug, `discover-${city.slug}`, city.timezone],
  );
  area = (await loadRestaurantArea(pool, city.slug))!;
  subjectId = (
    await pool.query<{ id: string }>(
      `INSERT INTO place_subject(city_id,city_review_status) VALUES($1,'approved') RETURNING id`,
      [city.id],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO place_provider_reference(subject_id,provider,provider_place_id) VALUES($1,'google',$2)`,
    [subjectId, providerId],
  );
  const candidate = (
    await pool.query<{ id: string }>(
      `INSERT INTO restaurant_candidate(area_id,subject_id,state,food_type,food_type_version) VALUES($1,$2,'approved','pizza',1) RETURNING id`,
      [area.id, subjectId],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO restaurant_evidence(candidate_id,label,approved_for_copy,approved_by,approved_at) VALUES($1,'Wood-fired pizza oven.',true,$2,now()),($1,'House-made sourdough.',true,$2,now())`,
    [candidate, actorId],
  );
});
test.afterAll(async () => {
  if (area) {
    await pool.query("DELETE FROM restaurant_job WHERE area_id=$1", [area.id]);
    await pool.query(
      "DELETE FROM layer_item WHERE layer_id IN(SELECT id FROM layer WHERE city_id=$1)",
      [city.id],
    );
    await pool.query(
      "UPDATE daily_pick_run SET final_pick_id=NULL WHERE area_id=$1",
      [area.id],
    );
    await pool.query("DELETE FROM daily_pick WHERE city_id=$1", [city.id]);
    await pool.query(
      "DELETE FROM restaurant_copy WHERE run_id IN(SELECT id FROM daily_pick_run WHERE area_id=$1)",
      [area.id],
    );
    await pool.query("DELETE FROM daily_pick_run WHERE area_id=$1", [area.id]);
    await pool.query(
      "DELETE FROM restaurant_evidence WHERE candidate_id IN(SELECT id FROM restaurant_candidate WHERE area_id=$1)",
      [area.id],
    );
    await pool.query("DELETE FROM restaurant_candidate WHERE area_id=$1", [
      area.id,
    ]);
    await pool.query("DELETE FROM restaurant_discovery_area WHERE id=$1", [
      area.id,
    ]);
  }
  await pool.query("DELETE FROM saved_place_subject WHERE subject_id=$1", [
    subjectId,
  ]);
  await pool.query("DELETE FROM place_provider_reference WHERE subject_id=$1", [
    subjectId,
  ]);
  await pool.query("DELETE FROM place_subject WHERE id=$1", [subjectId]);
  await pool.query("DELETE FROM moderation_action WHERE actor_id=$1", [
    actorId,
  ]);
  await pool.query("DELETE FROM layer WHERE city_id=$1", [city.id]);
  await pool.query("DELETE FROM city WHERE id=$1", [city.id]);
  await deleteTestAccount(email);
});
test("review, queue, publish, discover, save, withdraw, and translate a restaurant pick", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/(\/\/|\.)mapbox\.com\//, (r) => r.abort());
  await signIn(page, email);
  await page.goto("/admin/restaurant-picks");
  await page.getByLabel("Area", { exact: true }).selectOption(area.id);
  await page
    .getByRole("button", { name: "Queue recommendation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved");
  expect((await workRestaurantJob(area, adapters))?.status).toBe(
    "ready_for_review",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`${today} #1`) }).click();
  await expect(
    page.getByRole("heading", { name: `Top-10 report · ${today}` }),
  ).toBeVisible();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Queue publication", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Approve copy", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Queue publication", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Queue publication", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved");
  expect((await workRestaurantJob(area, adapters))?.status).toBe("created");
  await page.goto(`/?city=${city.slug}&layers=discover-${city.slug}`);
  await expect(
    page.getByRole("region", { name: "External businesses" }),
  ).toBeVisible();
  await page.goto(`/?city=${city.slug}&layers=daily-pick-${city.slug}`);
  const card = page.getByRole("region", { name: "Daily Pick", exact: true });
  await expect(card).toContainText(/wood-fired pizza oven/i);
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  expect(
    (
      await pool.query(
        "SELECT * FROM saved_place_subject WHERE subject_id=$1 AND user_id=$2",
        [subjectId, actorId],
      )
    ).rowCount,
  ).toBe(1);
  await page.goto("/admin/restaurant-picks");
  await page.getByLabel("Area", { exact: true }).selectOption(area.id);
  await page.getByRole("button", { name: new RegExp(`${today} #1`) }).click();
  page.once("dialog", (d) => d.accept("Fixture withdrawal"));
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  expect(
    (
      await pool.query(
        "SELECT id FROM daily_pick WHERE city_id=$1 AND status='published'",
        [city.id],
      )
    ).rowCount,
  ).toBe(0);
  await context.addCookies([
    {
      name: "locale",
      value: "zh-TW",
      url: "http://localhost:" + (process.env.E2E_PORT ?? 3000),
    },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "餐廳每日精選", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
