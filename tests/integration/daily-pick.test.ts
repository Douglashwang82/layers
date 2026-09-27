import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  pool,
  ensureSystemLayers,
  generateDailyPick,
  runDailyPickGeneration,
} from "../../packages/database/src";
import { runMapQuery } from "../../apps/web/src/features/map/query";
import {
  listDailyPickHistory,
  loadDailyPickView,
} from "../../apps/web/src/features/daily-pick/repository";
import {
  generateTodayPick,
  scheduleDailyPick,
  withdrawPick,
} from "../../apps/web/src/features/daily-pick/service";
import {
  addDays,
  localDate,
  parseMapQuery,
  type Actor,
} from "../../packages/shared/src";
/*
 * Isolated fixtures: a throwaway city with its own non-demo places, so the
 * shared demo catalog (all demo) is untouched and results are deterministic.
 */
const suffix = crypto.randomUUID().slice(0, 8);
const tz = "America/Chicago";
const city = {
  id: crypto.randomUUID(),
  slug: `dp-test-${suffix}`,
  name: "Pick Test City",
  timezone: tz,
  latitude: 29.76,
  longitude: -95.37,
};
const emptyCity = {
  ...city,
  id: crypto.randomUUID(),
  slug: `dp-empty-${suffix}`,
  name: "Empty Pick City",
};
const layer = `daily-pick-${city.slug}`;
const moderator: Actor = { id: crypto.randomUUID(), role: "MODERATOR" };
const member: Actor = { id: crypto.randomUUID(), role: "USER" };
const description =
  "A family-run spot with a published menu of Taiwanese dishes. The listing includes its address and neighborhood.";
const places = {
  tea: crypto.randomUUID(),
  bakery: crypto.randomUUID(),
  hotpot: crypto.randomUUID(),
  cafe: crypto.randomUUID(),
  demo: crypto.randomUUID(),
  hidden: crypto.randomUUID(),
  thin: crypto.randomUUID(),
};
const today = localDate(new Date(), tz);
async function insertPlace(
  id: string,
  category: string,
  neighborhood: string,
  extra: {
    status?: string;
    isDemo?: boolean;
    description?: string;
    cityId?: string;
  } = {},
) {
  await pool.query(
    `INSERT INTO place(id,slug,name,description,image,category,city_id,neighborhood,address,latitude,longitude,status,is_demo,source)
     VALUES($1,$2,$3,$4,'https://images.unsplash.com/photo-1?w=1200',$5,$6,$7,'1 Test St',29.7,-95.4,$8,$9,'Community submission')`,
    [
      id,
      `dp-${id.slice(0, 8)}`,
      `${category} test ${id.slice(0, 4)}`,
      extra.description ?? description,
      category,
      extra.cityId ?? city.id,
      neighborhood,
      extra.status ?? "approved",
      extra.isDemo ?? false,
    ],
  );
}
const state = (params: Record<string, string>) => {
  const parsed = parseMapQuery({ city: city.slug, ...params });
  return { ...parsed, layers: parsed.layers ?? [layer] };
};
async function publishedRows(cityId: string, date: string) {
  return (
    await pool.query<{ id: string; place_id: string }>(
      "SELECT id,place_id FROM daily_pick WHERE city_id=$1 AND pick_date=$2::date AND status='published'",
      [cityId, date],
    )
  ).rows;
}
beforeAll(async () => {
  for (const c of [city, emptyCity]) {
    await pool.query(
      "INSERT INTO city(id,slug,name,region,country,timezone,latitude,longitude) VALUES($1,$2,$3,'TX','USA',$4,$5,$6)",
      [c.id, c.slug, c.name, c.timezone, c.latitude, c.longitude],
    );
    await ensureSystemLayers(pool, c);
  }
  for (const actor of [moderator, member])
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [actor.id, "Pick Tester", `${actor.id}@example.test`, actor.role],
    );
  await insertPlace(places.tea, "Bubble Tea", "Bellaire");
  await insertPlace(places.bakery, "Bakery", "Chinatown");
  await insertPlace(places.hotpot, "Hot Pot", "Sugar Land");
  await insertPlace(places.cafe, "Cafe", "Heights");
  await insertPlace(places.demo, "Dessert", "Midtown", { isDemo: true });
  await insertPlace(places.hidden, "Taiwanese", "Katy", { status: "hidden" });
  await insertPlace(places.thin, "Breakfast", "Alief", {
    description: "Eggs.",
  });
});
afterAll(async () => {
  const ids = [city.id, emptyCity.id];
  await pool.query(
    "DELETE FROM moderation_action WHERE entity_type='daily_picks' AND entity_id IN (SELECT id FROM daily_pick WHERE city_id=ANY($1::uuid[]))",
    [ids],
  );
  await pool.query("DELETE FROM daily_pick WHERE city_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query("DELETE FROM layer WHERE city_id=ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM place WHERE city_id=ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM city WHERE id=ANY($1::uuid[])", [ids]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    [moderator.id, member.id],
  ]);
  await pool.end();
});
describe("Daily Pick generation", () => {
  it("publishes one shared pick per city/date, stable across repeated and concurrent runs", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => generateDailyPick(city, today)),
    );
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(new Set(results.map((r) => r.placeId)).size).toBe(1);
    const rows = await publishedRows(city.id, today);
    expect(rows).toHaveLength(1);
    const again = await generateDailyPick(city, today);
    expect(again).toMatchObject({ status: "unchanged", pickId: rows[0].id });
    // Only eligible, non-demo, visible, documented places can be chosen.
    expect([places.tea, places.bakery, places.hotpot, places.cafe]).toContain(
      rows[0].place_id,
    );
  });
  it("stores bilingual snapshots and the reasons that decided the pick", async () => {
    const row = (
      await pool.query(
        "SELECT selection_kind,selection_version,description,reasons,reason_text,reason_text_chinese,evidence FROM daily_pick WHERE city_id=$1 AND pick_date=$2::date AND status='published'",
        [city.id, today],
      )
    ).rows[0];
    expect(row.selection_kind).toBe("automatic");
    expect(row.selection_version).toBe(1);
    expect(row.description).toBe(description);
    expect(row.reasons.map((r: { code: string }) => r.code)).toContain(
      "not_recently_featured",
    );
    expect(row.reason_text).toMatch(/Daily Pick/);
    expect(row.reason_text_chinese).toMatch(/每日精選/);
    // Demo and hidden places never load; the thin description fails eligibility.
    expect(row.evidence).toMatchObject({ eligible: 4, candidates: 5 });
  });
  it("gives the next local day a new pick and refuses to rewrite the past", async () => {
    const tomorrow = addDays(today, 1);
    const next = await generateDailyPick(city, tomorrow);
    const [current] = await publishedRows(city.id, today);
    expect(next.status).toBe("created");
    expect(next.placeId).not.toBe(current.place_id);
    const past = await runDailyPickGeneration({
      citySlug: city.slug,
      date: addDays(today, -1),
    });
    expect(past.results).toHaveLength(0);
    expect(past.errors[0].message).toMatch(/Refusing/);
  });
  it("publishes an honest empty state when a city has no eligible places", async () => {
    const result = await generateDailyPick(emptyCity, today);
    expect(result).toMatchObject({ status: "empty", pickId: null });
    const map = await runMapQuery(
      {
        ...parseMapQuery({ city: emptyCity.slug }),
        layers: [`daily-pick-${emptyCity.slug}`],
      },
      emptyCity,
      null,
    );
    expect(map.dailyPick).toMatchObject({ pick: null, previous: null });
    expect(map.total).toBe(0);
  });
});
describe("Daily Pick on the map", () => {
  it("resolves the stored pick into map/list items and the card", async () => {
    const [row] = await publishedRows(city.id, today);
    const result = await runMapQuery(state({}), city, null);
    const key = `place:${row.place_id}`;
    expect(result.items.map((i) => i.key)).toEqual([key]);
    expect(result.items[0].layers).toEqual([layer]);
    expect(result.dailyPick?.pick?.key).toBe(key);
    expect(result.dailyPick?.inResults).toBe(true);
    expect(result.dailyPick?.date).toBe(today);
    expect(result.layers[0]).toMatchObject({ slug: layer, count: 1 });
    // A place in two applied layers stays one pin with both memberships.
    const both = await runMapQuery(
      state({ layers: `${layer},discover-${city.slug}` }),
      city,
      null,
    );
    const shared = both.items.find((i) => i.key === key)!;
    expect(shared.layers.sort()).toEqual(
      [`discover-${city.slug}`, layer].sort(),
    );
    expect(both.items.filter((i) => i.key === key)).toHaveLength(1);
  });
  it("keeps the city-wide pick when filters or the map area exclude it, and says so", async () => {
    const [row] = await publishedRows(city.id, today);
    const away = await runMapQuery(
      state({ area: "-80.5,40.1,-80.1,40.4" }),
      city,
      null,
    );
    expect(away.items).toHaveLength(0);
    expect(away.dailyPick?.pick?.kind).toBe("catalog");
    expect(
      away.dailyPick?.pick?.kind === "catalog"
        ? away.dailyPick.pick.placeId
        : null,
    ).toBe(row.place_id);
    expect(away.dailyPick?.inResults).toBe(false);
    const events = await runMapQuery(state({ types: "event" }), city, null);
    expect(events.dailyPick?.inResults).toBe(false);
    // A date filter never changes today's recommendation.
    const future = await runMapQuery(
      state({ date: addDays(today, 10) }),
      city,
      null,
    );
    expect(
      future.dailyPick?.pick?.kind === "catalog"
        ? future.dailyPick.pick.placeId
        : null,
    ).toBe(row.place_id);
    expect(future.dailyPick?.inResults).toBe(true);
  });
  it("never serves a hidden place from a stored pick, and the job replaces it with an audit link", async () => {
    const [row] = await publishedRows(city.id, today);
    await pool.query("UPDATE place SET status='hidden' WHERE id=$1", [
      row.place_id,
    ]);
    const { view } = await loadDailyPickView(city, null);
    expect(view.pick).toBeNull();
    const map = await runMapQuery(state({}), city, null);
    expect(map.items).toHaveLength(0);
    const history = await listDailyPickHistory(city, addDays(today, 1));
    expect(
      history.some((p) => p.kind === "catalog" && p.placeId === row.place_id),
    ).toBe(false);
    const replaced = await generateDailyPick(city, today);
    expect(replaced).toMatchObject({ status: "replaced", withdrawnId: row.id });
    expect(replaced.placeId).not.toBe(row.place_id);
    const old = (
      await pool.query(
        "SELECT status,withdrawn_at,withdrawal_reason FROM daily_pick WHERE id=$1",
        [row.id],
      )
    ).rows[0];
    expect(old.status).toBe("withdrawn");
    expect(old.withdrawn_at).not.toBeNull();
    const current = (
      await pool.query("SELECT replaces_id FROM daily_pick WHERE id=$1", [
        replaced.pickId,
      ])
    ).rows[0];
    expect(current.replaces_id).toBe(row.id);
    await pool.query("UPDATE place SET status='approved' WHERE id=$1", [
      row.place_id,
    ]);
  });
  it("lists dated history newest first", async () => {
    const history = await listDailyPickHistory(city, addDays(today, 1));
    expect(history.map((p) => p.date)).toEqual([addDays(today, 1), today]);
    expect(history.every((p) => p.reasonText.length > 0)).toBe(true);
  });
});
describe("Daily Pick moderation", () => {
  const date = addDays(today, 3);
  it("requires a moderator", async () => {
    await expect(
      scheduleDailyPick(member, {
        city: city.slug,
        date,
        placeId: places.cafe,
        reason: "Test",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(scheduleDailyPick(null, {})).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      generateTodayPick(member, { city: city.slug }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects past dates and ineligible places", async () => {
    await expect(
      scheduleDailyPick(moderator, {
        city: city.slug,
        date: addDays(today, -1),
        placeId: places.cafe,
        reason: "Test",
      }),
    ).rejects.toMatchObject({ code: "PAST_DATE" });
    for (const placeId of [places.demo, places.hidden, places.thin])
      await expect(
        scheduleDailyPick(moderator, {
          city: city.slug,
          date,
          placeId,
          reason: "Test",
        }),
      ).rejects.toMatchObject({ code: "INELIGIBLE" });
  });
  it("schedules an editorial pick, replaces it only with the current id, and audits both", async () => {
    const first = await scheduleDailyPick(moderator, {
      city: city.slug,
      date,
      placeId: places.cafe,
      reason: "Coffee week",
      note: "Featured for Coffee Week.",
    });
    expect(first.replaced).toBeNull();
    const scheduled = (
      await pool.query(
        "SELECT selection_kind,reason_text,reason_text_chinese,created_by FROM daily_pick WHERE id=$1",
        [first.id],
      )
    ).rows[0];
    expect(scheduled).toMatchObject({
      selection_kind: "editorial",
      reason_text: "Featured for Coffee Week.",
      reason_text_chinese: "Featured for Coffee Week.",
      created_by: moderator.id,
    });
    // The job keeps an editorial pick.
    expect((await generateDailyPick(city, date)).status).toBe("unchanged");
    await expect(
      scheduleDailyPick(moderator, {
        city: city.slug,
        date,
        placeId: places.hotpot,
        reason: "Stale form",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PICK_CHANGED" });
    const second = await scheduleDailyPick(moderator, {
      city: city.slug,
      date,
      placeId: places.hotpot,
      reason: "Cold front",
      expectedPickId: first.id,
    });
    expect(second.replaced).toBe(first.id);
    expect(await publishedRows(city.id, date)).toEqual([
      { id: second.id, place_id: places.hotpot },
    ]);
    const actions = (
      await pool.query(
        "SELECT entity_id,action,reason FROM moderation_action WHERE entity_type='daily_picks' AND entity_id=ANY($1::uuid[]) ORDER BY created_at",
        [[first.id, second.id]],
      )
    ).rows;
    expect(actions).toEqual(
      expect.arrayContaining([
        { entity_id: first.id, action: "scheduled", reason: "Coffee week" },
        { entity_id: first.id, action: "withdrawn", reason: "Cold front" },
        { entity_id: second.id, action: "replaced", reason: "Cold front" },
      ]),
    );
  });
  it("withdraws a pick without a replacement", async () => {
    const [row] = await publishedRows(city.id, date);
    const result = await withdrawPick(moderator, row.id, {
      reason: "Closed for renovation",
    });
    expect(result.status).toBe("withdrawn");
    expect(await publishedRows(city.id, date)).toHaveLength(0);
    await expect(
      withdrawPick(moderator, row.id, { reason: "Again" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects impossible calendar dates before touching the database", async () => {
    for (const bad of ["2027-02-29", "2026-02-30", "2026-13-01"])
      await expect(
        scheduleDailyPick(moderator, {
          city: city.slug,
          date: bad,
          placeId: places.cafe,
          reason: "Test",
        }),
      ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      runDailyPickGeneration({ citySlug: city.slug, date: "2026-02-30" }),
    ).rejects.toThrow(/Invalid date/);
  });
});
describe("Daily Pick moderator-run generation is atomic", () => {
  async function auditRows(ids: string[]) {
    return (
      await pool.query<{ entity_id: string; action: string; actor_id: string }>(
        "SELECT entity_id,action,actor_id FROM moderation_action WHERE entity_type='daily_picks' AND entity_id=ANY($1::uuid[])",
        [ids],
      )
    ).rows;
  }
  it("rolls back the withdrawal and replacement when the audit step fails", async () => {
    const [before] = await publishedRows(city.id, today);
    const slotRows = async () =>
      (
        await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM daily_pick WHERE city_id=$1 AND pick_date=$2::date",
          [city.id, today],
        )
      ).rows[0].count;
    const rowsBefore = await slotRows();
    await pool.query("UPDATE place SET status='hidden' WHERE id=$1", [
      before.place_id,
    ]);
    try {
      await expect(
        generateDailyPick(city, today, {
          actorId: moderator.id,
          onChange: async () => {
            throw new Error("audit failed");
          },
        }),
      ).rejects.toThrow("audit failed");
      // A moderator whose account no longer exists fails the audit foreign key.
      const ghost: Actor = { id: crypto.randomUUID(), role: "MODERATOR" };
      await expect(
        generateTodayPick(ghost, { city: city.slug }),
      ).rejects.toBeTruthy();
      expect(await publishedRows(city.id, today)).toEqual([before]);
      const row = (
        await pool.query(
          "SELECT status,withdrawn_at FROM daily_pick WHERE id=$1",
          [before.id],
        )
      ).rows[0];
      expect(row).toEqual({ status: "published", withdrawn_at: null });
      // No replacement row and no audit record survived the failed attempts.
      expect(await slotRows()).toBe(rowsBefore);
      expect(await auditRows([before.id])).toHaveLength(0);
      // The same run by a real moderator commits withdrawal, replacement and audit together.
      const result = await generateTodayPick(moderator, { city: city.slug });
      expect(result).toMatchObject({
        status: "replaced",
        withdrawnId: before.id,
      });
      const withdrawn = (
        await pool.query(
          "SELECT status,withdrawn_by FROM daily_pick WHERE id=$1",
          [before.id],
        )
      ).rows[0];
      expect(withdrawn).toEqual({
        status: "withdrawn",
        withdrawn_by: moderator.id,
      });
      expect(await auditRows([before.id, result.pickId!])).toEqual(
        expect.arrayContaining([
          { entity_id: before.id, action: "withdrawn", actor_id: moderator.id },
          {
            entity_id: result.pickId,
            action: "replaced",
            actor_id: moderator.id,
          },
        ]),
      );
      // Idempotent: a second run changes and audits nothing.
      const again = await generateTodayPick(moderator, { city: city.slug });
      expect(again.status).toBe("unchanged");
      expect(await auditRows([result.pickId!])).toHaveLength(1);
    } finally {
      await pool.query("UPDATE place SET status='approved' WHERE id=$1", [
        before.place_id,
      ]);
    }
  });
  it("audits an empty-after-withdrawal outcome in the same transaction", async () => {
    const only = crypto.randomUUID();
    await insertPlace(only, "Cafe", "Heights", { cityId: emptyCity.id });
    const created = await generateDailyPick(emptyCity, today);
    expect(created.status).toBe("created");
    await pool.query("UPDATE place SET status='hidden' WHERE id=$1", [only]);
    const result = await generateTodayPick(moderator, {
      city: emptyCity.slug,
    });
    expect(result).toMatchObject({
      status: "empty",
      pickId: null,
      withdrawnId: created.pickId,
    });
    expect(await publishedRows(emptyCity.id, today)).toHaveLength(0);
    expect(await auditRows([created.pickId!])).toEqual([
      {
        entity_id: created.pickId,
        action: "withdrawn",
        actor_id: moderator.id,
      },
    ]);
  });
});
