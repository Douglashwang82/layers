import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  pool,
  ensureSystemLayers,
  createFakeCopyAdapter,
  createFakeQualificationAdapter,
  loadRestaurantArea,
  runRestaurantPick,
  withdrawRestaurantPick,
  type RestaurantArea,
} from "../../packages/database/src";
import { listExternalReferences } from "../../apps/web/src/features/map/external";
import {
  parseMapQuery,
  localDate,
  type Actor,
} from "../../packages/shared/src";

/*
 * Isolated fixtures: a throwaway city so the demo catalog and other cities'
 * Discover layers are untouched. Both provider place IDs are synthetic test
 * strings; no live provider or model call is made anywhere in this file.
 */
const suffix = crypto.randomUUID().slice(0, 8);
const tz = "America/Chicago";
const city = {
  id: crypto.randomUUID(),
  slug: `rp-test-${suffix}`,
  name: "Restaurant Pick Test City",
  timezone: tz,
  latitude: 29.76,
  longitude: -95.37,
};
const moderator: Actor = { id: crypto.randomUUID(), role: "MODERATOR" };
const today = localDate(new Date(), tz);
const providerA = `test-provider-${suffix}-a`;
const providerB = `test-provider-${suffix}-b`;
const subjectIds: string[] = [];
const candidateIds: string[] = [];
let area: RestaurantArea;
const discoverSlug = () => `discover-${city.slug}`;

async function insertCandidate(
  providerPlaceId: string,
  foodType: string,
  facts: string[],
) {
  const subject = await pool.query<{ id: string }>(
    `INSERT INTO place_subject(city_id, city_review_status, city_reviewed_by, city_reviewed_at)
     VALUES($1,'approved',$2,now()) RETURNING id`,
    [city.id, moderator.id],
  );
  const subjectId = subject.rows[0].id;
  subjectIds.push(subjectId);
  await pool.query(
    `INSERT INTO place_provider_reference(subject_id, provider, provider_place_id) VALUES($1,'google',$2)`,
    [subjectId, providerPlaceId],
  );
  const candidate = await pool.query<{ id: string }>(
    `INSERT INTO restaurant_candidate(area_id, subject_id, state, food_type, food_type_version, food_type_source, reviewed_by, reviewed_at)
     VALUES($1,$2,'approved',$3,1,'moderator',$4,now()) RETURNING id`,
    [area.id, subjectId, foodType, moderator.id],
  );
  const candidateId = candidate.rows[0].id;
  candidateIds.push(candidateId);
  for (const label of facts)
    await pool.query(
      `INSERT INTO restaurant_evidence(candidate_id, label, approved_for_copy, approved_by, approved_at)
       VALUES($1,$2,true,$3,now())`,
      [candidateId, label, moderator.id],
    );
  return subjectId;
}

beforeAll(async () => {
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
  await pool.query(
    'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
    [
      moderator.id,
      "Restaurant Pick Tester",
      `${moderator.id}@example.test`,
      moderator.role,
    ],
  );
  const areaInsert = await pool.query<{ id: string }>(
    `INSERT INTO restaurant_discovery_area(city_slug, layer_slug, timezone, config_version, config, enabled)
     VALUES($1,$2,$3,1,'{}'::jsonb,true) RETURNING id`,
    [city.slug, discoverSlug(), tz],
  );
  area = (await loadRestaurantArea(pool, city.slug))!;
  expect(area.id).toBe(areaInsert.rows[0].id);
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM daily_pick_layer_membership WHERE layer_id IN (SELECT id FROM layer WHERE city_id=$1)",
    [city.id],
  );
  await pool.query(
    "DELETE FROM layer_item WHERE layer_id IN (SELECT id FROM layer WHERE city_id=$1)",
    [city.id],
  );
  await pool.query(
    "DELETE FROM daily_pick_run_candidate WHERE run_id IN (SELECT id FROM daily_pick_run WHERE area_id=$1)",
    [area.id],
  );
  await pool.query(
    "UPDATE daily_pick_run SET final_pick_id=NULL WHERE area_id=$1",
    [area.id],
  );
  await pool.query("DELETE FROM daily_pick WHERE city_id=$1", [city.id]);
  await pool.query("DELETE FROM daily_pick_run WHERE area_id=$1", [area.id]);
  await pool.query(
    "DELETE FROM restaurant_evidence WHERE candidate_id = ANY($1::uuid[])",
    [candidateIds],
  );
  await pool.query("DELETE FROM restaurant_candidate WHERE area_id=$1", [
    area.id,
  ]);
  await pool.query("DELETE FROM restaurant_discovery_area WHERE id=$1", [
    area.id,
  ]);
  await pool.query(
    "DELETE FROM place_provider_reference WHERE subject_id = ANY($1::uuid[])",
    [subjectIds],
  );
  await pool.query("DELETE FROM place_subject WHERE id = ANY($1::uuid[])", [
    subjectIds,
  ]);
  await pool.query("DELETE FROM layer WHERE city_id=$1", [city.id]);
  await pool.query("DELETE FROM city WHERE id=$1", [city.id]);
  await pool.query('DELETE FROM "user" WHERE id=$1', [moderator.id]);
  await pool.end();
});

describe("Daily restaurant recommendation (version 2) worker", () => {
  it("qualifies, ranks, publishes the winner atomically, and surfaces it in Discover", async () => {
    const winnerSubject = await insertCandidate(providerA, "tacos", [
      "Handmade tortillas made daily.",
      "Weekend barbacoa special.",
    ]);
    const loserSubject = await insertCandidate(providerB, "ramen", [
      "Tonkotsu broth simmered 18 hours.",
      "House-made noodles.",
    ]);
    const qualification = createFakeQualificationAdapter(
      new Map([
        [
          providerA,
          {
            rating: 4.6,
            ratingCount: 120,
            businessStatus: "OPERATIONAL",
            hoursByDate: new Map([
              [today, { date: today, periods: [{ open: 600, close: 1320 }] }],
            ]),
          },
        ],
        [
          providerB,
          {
            rating: 4.4,
            ratingCount: 40,
            businessStatus: "OPERATIONAL",
            hoursByDate: new Map([
              [today, { date: today, periods: [{ open: 600, close: 1320 }] }],
            ]),
          },
        ],
      ]),
    );
    const copy = createFakeCopyAdapter();
    const result = await runRestaurantPick(area, today, {
      qualification,
      copy,
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    expect(result.subjectId).toBe(winnerSubject);

    const pickRow = await pool.query<{
      subject_id: string;
      food_type: string;
      status: string;
      selection_version: number;
    }>(
      "SELECT subject_id, food_type, status, selection_version FROM daily_pick WHERE id=$1",
      [result.pickId],
    );
    expect(pickRow.rows[0]).toMatchObject({
      subject_id: winnerSubject,
      food_type: "tacos",
      status: "published",
      selection_version: 2,
    });

    const membership = await pool.query<{
      layer_id: string;
      layer_item_id: string;
    }>(
      "SELECT layer_id, layer_item_id FROM daily_pick_layer_membership WHERE pick_id=$1",
      [result.pickId],
    );
    expect(membership.rows).toHaveLength(1);
    const layerItem = await pool.query<{
      subject_id: string;
      valid_from: Date;
    }>("SELECT subject_id, valid_from FROM layer_item WHERE id=$1", [
      membership.rows[0].layer_item_id,
    ]);
    expect(layerItem.rows[0].subject_id).toBe(winnerSubject);
    expect(layerItem.rows[0].valid_from).not.toBeNull();

    const run = await pool.query<{ status: string; final_pick_id: string }>(
      "SELECT status, final_pick_id FROM daily_pick_run WHERE id=$1",
      [result.runId],
    );
    expect(run.rows[0]).toMatchObject({
      status: "published",
      final_pick_id: result.pickId,
    });
    const reportRows = await pool.query<{
      subject_id: string;
      decision: string;
      primary_reason_code: string;
    }>(
      "SELECT subject_id, decision, primary_reason_code FROM daily_pick_run_candidate WHERE run_id=$1 ORDER BY report_position",
      [result.runId],
    );
    expect(reportRows.rows[0]).toMatchObject({
      subject_id: winnerSubject,
      decision: "picked",
    });
    const loserRow = reportRows.rows.find(
      (r) => r.subject_id === loserSubject,
    )!;
    expect(loserRow.decision).toBe("eligible_not_picked");
    expect(loserRow.primary_reason_code).toBe("lower_quality_score");

    // The winner now appears through the same public external-reference path
    // the map and Daily Pick card use, scoped to the Discover layer.
    const state = {
      ...parseMapQuery({ city: city.slug }),
      layers: [discoverSlug()],
    };
    const references = await listExternalReferences(
      state,
      city,
      null,
      0,
      new Date(),
    );
    expect(references.references.map((r) => r.subjectId)).toContain(
      winnerSubject,
    );
    expect(references.references.map((r) => r.subjectId)).not.toContain(
      loserSubject,
    );

    // Withdrawal removes the Discover membership without deleting the pick's audit trail.
    await withdrawRestaurantPick(
      result.pickId,
      "test withdrawal",
      moderator.id,
    );
    const afterWithdraw = await pool.query<{ status: string }>(
      "SELECT status FROM daily_pick WHERE id=$1",
      [result.pickId],
    );
    expect(afterWithdraw.rows[0].status).toBe("withdrawn");
    const referencesAfter = await listExternalReferences(
      state,
      city,
      null,
      0,
      new Date(),
    );
    expect(referencesAfter.references.map((r) => r.subjectId)).not.toContain(
      winnerSubject,
    );
  });

  it("reports an honest empty outcome when nothing qualifies, without publishing", async () => {
    await pool.query(
      `INSERT INTO restaurant_discovery_area(city_slug, layer_slug, timezone, config_version, config, enabled)
       VALUES($1,$2,$3,1,'{}'::jsonb,true)`,
      [`${city.slug}-empty`, `discover-${city.slug}-empty`, tz],
    );
    const emptyAreaLoaded = (await loadRestaurantArea(
      pool,
      `${city.slug}-empty`,
    ))!;
    const qualification = createFakeQualificationAdapter(new Map());
    const copy = createFakeCopyAdapter();
    const result = await runRestaurantPick(emptyAreaLoaded, today, {
      qualification,
      copy,
    });
    expect(result.status).toBe("empty");
    if (result.status === "empty")
      expect(result.reason).toBe("no_eligible_candidates");
    await pool.query("DELETE FROM daily_pick_run WHERE area_id=$1", [
      emptyAreaLoaded.id,
    ]);
    await pool.query("DELETE FROM restaurant_discovery_area WHERE id=$1", [
      emptyAreaLoaded.id,
    ]);
  });

  it("refuses to run for a disabled area", async () => {
    const disabledArea: RestaurantArea = { ...area, enabled: false };
    await expect(
      runRestaurantPick(disabledArea, today, {
        qualification: createFakeQualificationAdapter(new Map()),
        copy: createFakeCopyAdapter(),
      }),
    ).rejects.toThrow(/disabled area/);
  });
});
