import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import {
  pool,
  ensureSystemLayers,
  approveRestaurantCopy,
  createFakeCopyAdapter,
  createFakeDiscoveryAdapter,
  createFakeQualificationAdapter,
  loadRestaurantArea,
  prepareRestaurantPickRun,
  publishRestaurantPickRun,
  runDailyPickGeneration,
  withdrawRestaurantPick,
  type RestaurantArea,
  type RestaurantQualificationAdapter,
} from "../../packages/database/src";
import { listExternalReferences } from "../../apps/web/src/features/map/external";
import { listCandidates } from "../../apps/web/src/features/restaurant-admin/service";
import {
  listDailyPickHistory,
  loadDailyPickView,
} from "../../apps/web/src/features/daily-pick/repository";
import {
  addDays,
  parseMapQuery,
  localDate,
  type Actor,
} from "../../packages/shared/src";

/*
 * Isolated fixtures: a throwaway city so the demo catalog and other cities'
 * Discover layers are untouched. All provider place IDs are synthetic test
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
const subjectIds: string[] = [];
const candidateIds: string[] = [];
const placeIds: string[] = [];
let area: RestaurantArea;
const discoverSlug = () => `discover-${city.slug}`;
let n = 0;

function operationalQuality(rating: number, ratingCount: number, date = today) {
  return {
    rating,
    ratingCount,
    businessStatus: "OPERATIONAL" as const,
    hoursByDate: new Map([
      [date, { date, periods: [{ open: 0, close: 1440 }] }],
    ]),
  };
}

async function insertCandidate(options: {
  foodType: string;
  facts: string[];
  catalogPlace?: { status: string; isDemo: boolean; citySlug?: string };
}) {
  n += 1;
  const providerPlaceId = `test-provider-${suffix}-${n}`;
  let catalogPlaceId: string | null = null;
  const subjectCityId = city.id;
  if (options.catalogPlace) {
    catalogPlaceId = crypto.randomUUID();
    placeIds.push(catalogPlaceId);
    await pool.query(
      `INSERT INTO place(id,slug,name,description,image,category,city_id,neighborhood,address,latitude,longitude,status,is_demo,source)
       VALUES($1,$2,$3,'A test place.','https://images.unsplash.com/photo-1?w=1200','Other',$4,'Test','1 Test St',29.7,-95.4,$5,$6,'Community submission')`,
      [
        catalogPlaceId,
        `rp-${catalogPlaceId.slice(0, 8)}`,
        `Catalog place ${n}`,
        city.id,
        options.catalogPlace.status,
        options.catalogPlace.isDemo,
      ],
    );
  }
  const subject = await pool.query<{ id: string }>(
    `INSERT INTO place_subject(catalog_place_id, city_id, city_review_status, city_reviewed_by, city_reviewed_at)
     VALUES($1,$2,'approved',$3,now()) RETURNING id`,
    [catalogPlaceId, subjectCityId, moderator.id],
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
    [area.id, subjectId, options.foodType, moderator.id],
  );
  const candidateId = candidate.rows[0].id;
  candidateIds.push(candidateId);
  for (const label of options.facts)
    await pool.query(
      `INSERT INTO restaurant_evidence(candidate_id, label, approved_for_copy, approved_by, approved_at)
       VALUES($1,$2,true,$3,now())`,
      [candidateId, label, moderator.id],
    );
  return { subjectId, providerPlaceId, candidateId };
}

async function prepareAndApprove(
  targetArea: RestaurantArea,
  date: string,
  qualification: RestaurantQualificationAdapter,
) {
  const result = await prepareRestaurantPickRun(targetArea, date, {
    qualification,
    copy: createFakeCopyAdapter(),
  });
  if (result.status !== "ready_for_review")
    throw new Error(`Expected ready_for_review, got ${result.status}`);
  await approveRestaurantCopy(result.copyId, moderator.id);
  return result;
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
  await pool.query(
    `INSERT INTO restaurant_discovery_area(city_slug, layer_slug, timezone, config_version, config, enabled)
     VALUES($1,$2,$3,1,'{}'::jsonb,true)`,
    [city.slug, discoverSlug(), tz],
  );
  area = (await loadRestaurantArea(pool, city.slug))!;
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
    "DELETE FROM daily_pick_run_candidate WHERE run_id IN (SELECT id FROM daily_pick_run WHERE area_id IN (SELECT id FROM restaurant_discovery_area WHERE city_slug LIKE $1))",
    [`${city.slug}%`],
  );
  await pool.query(
    "UPDATE daily_pick_run SET final_pick_id=NULL WHERE area_id IN (SELECT id FROM restaurant_discovery_area WHERE city_slug LIKE $1)",
    [`${city.slug}%`],
  );
  await pool.query("UPDATE daily_pick SET copy_id=NULL WHERE city_id=$1", [
    city.id,
  ]);
  await pool.query(
    "DELETE FROM restaurant_copy WHERE candidate_id = ANY($1::uuid[])",
    [candidateIds],
  );
  await pool.query("DELETE FROM daily_pick WHERE city_id=$1", [city.id]);
  await pool.query(
    "DELETE FROM daily_pick_run WHERE area_id IN (SELECT id FROM restaurant_discovery_area WHERE city_slug LIKE $1)",
    [`${city.slug}%`],
  );
  await pool.query(
    "DELETE FROM restaurant_discovery_run WHERE area_id IN (SELECT id FROM restaurant_discovery_area WHERE city_slug LIKE $1)",
    [`${city.slug}%`],
  );
  await pool.query(
    "DELETE FROM restaurant_evidence WHERE candidate_id = ANY($1::uuid[])",
    [candidateIds],
  );
  await pool.query(
    "DELETE FROM restaurant_candidate WHERE area_id IN (SELECT id FROM restaurant_discovery_area WHERE city_slug LIKE $1)",
    [`${city.slug}%`],
  );
  await pool.query(
    "DELETE FROM restaurant_discovery_area WHERE city_slug LIKE $1",
    [`${city.slug}%`],
  );
  await pool.query(
    "DELETE FROM place_provider_reference WHERE subject_id = ANY($1::uuid[])",
    [subjectIds],
  );
  await pool.query("DELETE FROM place_subject WHERE id = ANY($1::uuid[])", [
    subjectIds,
  ]);
  await pool.query("DELETE FROM place WHERE id = ANY($1::uuid[])", [placeIds]);
  await pool.query("DELETE FROM layer WHERE city_id=$1", [city.id]);
  await pool.query("DELETE FROM city WHERE id=$1", [city.id]);
  await pool.query("DELETE FROM moderation_action WHERE actor_id=$1", [
    moderator.id,
  ]);
  await pool.query('DELETE FROM "user" WHERE id=$1', [moderator.id]);
  await pool.end();
});

describe("Daily restaurant recommendation (version 2) worker", () => {
  // Every test shares one area for simplicity; exclude each test's own
  // candidates once it finishes so later tests' evaluations aren't
  // contaminated by earlier tests' still-"approved" candidates (which would
  // otherwise also be re-evaluated by loadApprovedCandidates, since
  // candidates aren't date-scoped).
  afterEach(async () => {
    await pool.query(
      "UPDATE restaurant_candidate SET state='excluded' WHERE area_id=$1 AND state='approved'",
      [area.id],
    );
  });

  it("prepares a report, requires copy approval, then publishes atomically and surfaces in Discover", async () => {
    const winner = await insertCandidate({
      foodType: "tacos",
      facts: ["Handmade tortillas made daily.", "Weekend barbacoa special."],
    });
    const loser = await insertCandidate({
      foodType: "ramen",
      facts: ["Tonkotsu broth simmered 18 hours.", "House-made noodles."],
    });
    const qualification = createFakeQualificationAdapter(
      new Map([
        [winner.providerPlaceId, operationalQuality(4.6, 120)],
        [loser.providerPlaceId, operationalQuality(4.4, 40)],
      ]),
    );

    const prepared = await prepareRestaurantPickRun(area, today, {
      qualification,
      copy: createFakeCopyAdapter(),
    });
    expect(prepared.status).toBe("ready_for_review");
    if (prepared.status !== "ready_for_review") throw new Error("unreachable");
    expect(prepared.winnerSubjectId).toBe(winner.subjectId);

    // Publication must refuse until a human approves the copy.
    const beforeApproval = await publishRestaurantPickRun(
      prepared.runId,
      moderator.id,
      { qualification },
    );
    expect(beforeApproval.status).toBe("copy_not_approved");

    await approveRestaurantCopy(prepared.copyId, moderator.id);
    const published = await publishRestaurantPickRun(
      prepared.runId,
      moderator.id,
      { qualification },
    );
    expect(published.status).toBe("created");
    if (published.status !== "created") throw new Error("unreachable");
    expect(published.subjectId).toBe(winner.subjectId);

    const pickRow = await pool.query<{
      subject_id: string;
      food_type: string;
      status: string;
      selection_version: number;
      copy_id: string;
    }>(
      "SELECT subject_id, food_type, status, selection_version, copy_id FROM daily_pick WHERE id=$1",
      [published.pickId],
    );
    expect(pickRow.rows[0]).toMatchObject({
      subject_id: winner.subjectId,
      food_type: "tacos",
      status: "published",
      selection_version: 2,
    });
    expect(pickRow.rows[0].copy_id).toBe(prepared.copyId);

    // An external winner contributes to both its area's Discover layer and
    // the city's own separate Daily Pick layer.
    const membership = await pool.query<{ slug: string }>(
      `SELECT l.slug FROM daily_pick_layer_membership m JOIN layer l ON l.id=m.layer_id WHERE m.pick_id=$1`,
      [published.pickId],
    );
    expect(membership.rows.map((r) => r.slug).sort()).toEqual(
      [discoverSlug(), `daily-pick-${city.slug}`].sort(),
    );

    const run = await pool.query<{
      status: string;
      final_pick_id: string;
      copy_status: string;
    }>(
      "SELECT status, final_pick_id, copy_status FROM daily_pick_run WHERE id=$1",
      [prepared.runId],
    );
    expect(run.rows[0]).toMatchObject({
      status: "published",
      final_pick_id: published.pickId,
      copy_status: "approved",
    });

    const reportRows = await pool.query<{
      subject_id: string;
      decision: string;
      primary_reason_code: string;
    }>(
      "SELECT subject_id, decision, primary_reason_code FROM daily_pick_run_candidate WHERE run_id=$1 ORDER BY report_position",
      [prepared.runId],
    );
    expect(reportRows.rows[0]).toMatchObject({
      subject_id: winner.subjectId,
      decision: "picked",
    });
    const loserRow = reportRows.rows.find(
      (r) => r.subject_id === loser.subjectId,
    )!;
    expect(loserRow.decision).toBe("eligible_not_picked");
    expect(loserRow.primary_reason_code).toBe("lower_quality_score");

    // Retrying publish on an already-published run is a stable no-op.
    const retried = await publishRestaurantPickRun(
      prepared.runId,
      moderator.id,
      {
        qualification,
      },
    );
    expect(retried).toMatchObject({
      status: "unchanged",
      pickId: published.pickId,
    });

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
      winner.subjectId,
    );
    expect(references.references.map((r) => r.subjectId)).not.toContain(
      loser.subjectId,
    );

    // The city's own separate Daily Pick layer must also surface the
    // winner, not just Discover — the worker publishes a layer_item into
    // both, since that layer's external-reference branch queries its own
    // layer_item rows.
    const dailyPickState = {
      ...parseMapQuery({ city: city.slug }),
      layers: [`daily-pick-${city.slug}`],
    };
    const dailyPickReferences = await listExternalReferences(
      dailyPickState,
      city,
      null,
      0,
      new Date(),
    );
    expect(dailyPickReferences.references.map((r) => r.subjectId)).toContain(
      winner.subjectId,
    );

    await withdrawRestaurantPick(
      published.pickId,
      "test withdrawal",
      moderator.id,
    );
    const afterWithdraw = await pool.query<{ status: string }>(
      "SELECT status FROM daily_pick WHERE id=$1",
      [published.pickId],
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
      winner.subjectId,
    );
    const dailyPickReferencesAfter = await listExternalReferences(
      dailyPickState,
      city,
      null,
      0,
      new Date(),
    );
    expect(
      dailyPickReferencesAfter.references.map((r) => r.subjectId),
    ).not.toContain(winner.subjectId);
  });

  it("projects an external winner as a subject-backed card in the public Daily Pick view and history", async () => {
    const winner = await insertCandidate({
      foodType: "vietnamese",
      facts: ["Broth simmered overnight.", "Fresh herb plate included."],
    });
    const qualification = createFakeQualificationAdapter(
      new Map([[winner.providerPlaceId, operationalQuality(4.6, 80)]]),
    );
    const prepared = await prepareAndApprove(area, today, qualification);
    const published = await publishRestaurantPickRun(
      prepared.runId,
      moderator.id,
      { qualification },
    );
    expect(published.status).toBe("created");

    const { view } = await loadDailyPickView(city, null, new Date());
    expect(view.pick).not.toBeNull();
    expect(view.pick).toMatchObject({
      kind: "external",
      subjectId: winner.subjectId,
      foodType: "vietnamese",
      providerPlaceId: winner.providerPlaceId,
      href: `/place-subjects/${winner.subjectId}`,
    });
    expect(view.pick!.description.length).toBeGreaterThan(0);

    const history = await listDailyPickHistory(city, today, 5);
    const historyRow = history.find((p) => p.date === today)!;
    expect(historyRow).toMatchObject({
      kind: "external",
      subjectId: winner.subjectId,
    });

    // Saving an external winner uses saved_place_subject, not saved_place.
    await pool.query(
      "INSERT INTO saved_place_subject(user_id, subject_id) VALUES($1,$2)",
      [moderator.id, winner.subjectId],
    );
    const { view: savedView } = await loadDailyPickView(
      city,
      moderator,
      new Date(),
    );
    expect(savedView.saved).toBe(true);
    await pool.query(
      "DELETE FROM saved_place_subject WHERE user_id=$1 AND subject_id=$2",
      [moderator.id, winner.subjectId],
    );

    if (published.status === "created")
      await withdrawRestaurantPick(
        published.pickId,
        "test cleanup",
        moderator.id,
      );
  });

  it("rejects a stale publish when evidence changed after the report was written", async () => {
    const date = addDays(today, 1);
    const winner = await insertCandidate({
      foodType: "pizza",
      facts: ["Wood-fired oven.", "Weekly special pie."],
    });
    const qualification = createFakeQualificationAdapter(
      new Map([[winner.providerPlaceId, operationalQuality(4.6, 120, date)]]),
    );
    const prepared = await prepareAndApprove(area, date, qualification);

    // Revoke one approved fact after the report was written: the candidate
    // now has fewer than two approved facts and should no longer qualify.
    await pool.query(
      `UPDATE restaurant_evidence SET approved_for_copy=false WHERE candidate_id=$1 AND label=$2`,
      [winner.candidateId, "Weekly special pie."],
    );

    const published = await publishRestaurantPickRun(
      prepared.runId,
      moderator.id,
      {
        qualification,
      },
    );
    expect(published.status).toBe("stale");

    // restore for afterAll cleanup consistency / other tests
    await pool.query(
      `UPDATE restaurant_evidence SET approved_for_copy=true WHERE candidate_id=$1 AND label=$2`,
      [winner.candidateId, "Weekly special pie."],
    );
  });

  it("returns a revision conflict instead of silently replacing a differently-expected pick", async () => {
    const date = addDays(today, 2);
    const first = await insertCandidate({
      foodType: "sushi",
      facts: ["Fresh fish delivered daily.", "Omakase available."],
    });
    const qualification1 = createFakeQualificationAdapter(
      new Map([[first.providerPlaceId, operationalQuality(4.5, 60, date)]]),
    );
    const prepared1 = await prepareAndApprove(area, date, qualification1);
    const published1 = await publishRestaurantPickRun(
      prepared1.runId,
      moderator.id,
      {
        qualification: qualification1,
      },
    );
    expect(published1.status).toBe("created");

    // A second candidate, a second run, targeting the SAME date/slot.
    const second = await insertCandidate({
      foodType: "burgers",
      facts: ["Griddle-smashed patties.", "House-made buns."],
    });
    const qualification2 = createFakeQualificationAdapter(
      new Map([
        [first.providerPlaceId, operationalQuality(4.5, 60, date)],
        [second.providerPlaceId, operationalQuality(4.9, 200, date)],
      ]),
    );
    const prepared2 = await prepareAndApprove(area, date, qualification2);
    expect(prepared2.winnerSubjectId).toBe(second.subjectId);

    // Publishing without confirming the expected current pick must not
    // silently overwrite the first winner.
    const conflict = await publishRestaurantPickRun(
      prepared2.runId,
      moderator.id,
      {
        qualification: qualification2,
      },
    );
    expect(conflict.status).toBe("revision_conflict");
    if (conflict.status !== "revision_conflict") throw new Error("unreachable");
    expect(conflict.currentPickId).toBe(
      published1.status === "created" ? published1.pickId : "",
    );

    // Confirming the expected pick lets the replace proceed.
    const replaced = await publishRestaurantPickRun(
      prepared2.runId,
      moderator.id,
      { qualification: qualification2 },
      { expectedPickId: conflict.currentPickId },
    );
    expect(replaced.status).toBe("replaced");
  });

  it("never qualifies a hidden, different-city, or demo linked catalog place", async () => {
    const date = addDays(today, 3);
    const hidden = await insertCandidate({
      foodType: "hot pot",
      facts: ["Broth base choice.", "Unlimited refills."],
      catalogPlace: { status: "hidden", isDemo: false },
    });
    const demo = await insertCandidate({
      foodType: "dim sum",
      facts: ["Cart service.", "Weekend only."],
      catalogPlace: { status: "approved", isDemo: true },
    });
    const qualification = createFakeQualificationAdapter(
      new Map([
        [hidden.providerPlaceId, operationalQuality(4.8, 500, date)],
        [demo.providerPlaceId, operationalQuality(4.9, 900, date)],
      ]),
    );
    const result = await prepareRestaurantPickRun(area, date, {
      qualification,
      copy: createFakeCopyAdapter(),
    });
    expect(result.status).toBe("empty");
    if (result.status !== "empty") throw new Error("unreachable");
    expect(result.reason).toBe("no_eligible_candidates");
    const rows = await pool.query<{ subject_id: string; all: string[] }>(
      "SELECT subject_id, reason_codes AS all FROM daily_pick_run_candidate WHERE run_id=$1",
      [result.runId],
    );
    for (const row of rows.rows) expect(row.all).toContain("area_unreviewed");
  });

  it("reports failed (not empty) when every qualification call errors out", async () => {
    const date = addDays(today, 4);
    const winner = await insertCandidate({
      foodType: "seafood",
      facts: ["Daily catch board.", "Raw bar."],
    });
    const throwingAdapter: RestaurantQualificationAdapter = {
      async fetchQuality() {
        throw new Error("simulated transport failure");
      },
    };
    const result = await prepareRestaurantPickRun(area, date, {
      qualification: throwingAdapter,
      copy: createFakeCopyAdapter(),
    });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.errorCode).toBe("qualification_unavailable");
    void winner;
  });

  it("lets the same restaurant win again after its rotation window, sharing one Discover layer_item across both picks", async () => {
    const restaurant = await insertCandidate({
      foodType: "steakhouse",
      facts: ["Dry-aged in house.", "Tableside service."],
    });
    const firstDate = addDays(today, 10);
    const secondDate = addDays(today, 41); // >30 days later
    const qualification = createFakeQualificationAdapter(
      new Map([
        [restaurant.providerPlaceId, operationalQuality(4.7, 300, firstDate)],
      ]),
    );
    const prepared1 = await prepareAndApprove(area, firstDate, qualification);
    const published1 = await publishRestaurantPickRun(
      prepared1.runId,
      moderator.id,
      {
        qualification,
      },
    );
    expect(published1.status).toBe("created");
    await withdrawRestaurantPick(
      published1.status === "created" ? published1.pickId : "",
      "test rotation withdrawal",
      moderator.id,
    );

    const qualification2 = createFakeQualificationAdapter(
      new Map([
        [restaurant.providerPlaceId, operationalQuality(4.7, 300, secondDate)],
      ]),
    );
    const prepared2 = await prepareAndApprove(area, secondDate, qualification2);
    expect(prepared2.winnerSubjectId).toBe(restaurant.subjectId);
    const published2 = await publishRestaurantPickRun(
      prepared2.runId,
      moderator.id,
      {
        qualification: qualification2,
      },
    );
    expect(published2.status).toBe("created");

    const items = await pool.query<{ layer_id: string; id: string }>(
      "SELECT DISTINCT layer_id, layer_item_id AS id FROM daily_pick_layer_membership WHERE pick_id = ANY($1::uuid[])",
      [
        [
          published1.status === "created" ? published1.pickId : "",
          published2.status === "created" ? published2.pickId : "",
        ],
      ],
    );
    // Each of the two layers (Discover + Daily Pick) has exactly one shared
    // layer_item reused by both picks (no unique-constraint failure, no
    // orphaned duplicate item for the same restaurant/layer).
    expect(items.rows).toHaveLength(2);
    const byLayer = new Map(items.rows.map((r) => [r.layer_id, r.id]));
    expect(byLayer.size).toBe(2);
  });

  it("withdrawal preserves an independently-curated layer_item", async () => {
    const restaurant = await insertCandidate({
      foodType: "bakery",
      facts: ["Sourdough baked daily.", "Seasonal pastries."],
    });
    const date = addDays(today, 20);
    // A moderator independently curates this subject into Discover first,
    // unrelated to any pick (added_by set to a real user).
    const layerRow = await pool.query<{ id: string }>(
      "SELECT id FROM layer WHERE slug=$1",
      [discoverSlug()],
    );
    const independentItem = await pool.query<{ id: string }>(
      `INSERT INTO layer_item(layer_id, subject_id, note, added_by) VALUES($1,$2,'Independently curated',$3) RETURNING id`,
      [layerRow.rows[0].id, restaurant.subjectId, moderator.id],
    );

    const qualification = createFakeQualificationAdapter(
      new Map([
        [restaurant.providerPlaceId, operationalQuality(4.6, 150, date)],
      ]),
    );
    const prepared = await prepareAndApprove(area, date, qualification);
    const published = await publishRestaurantPickRun(
      prepared.runId,
      moderator.id,
      {
        qualification,
      },
    );
    expect(published.status).toBe("created");
    if (published.status !== "created") throw new Error("unreachable");

    await withdrawRestaurantPick(
      published.pickId,
      "test withdrawal",
      moderator.id,
    );
    const stillThere = await pool.query<{ id: string }>(
      "SELECT id FROM layer_item WHERE id=$1",
      [independentItem.rows[0].id],
    );
    expect(stillThere.rows).toHaveLength(1);
  });

  it("includes withdrawn version 2 history in the restaurant-repeat window", async () => {
    const restaurant = await insertCandidate({
      foodType: "korean",
      facts: ["Tabletop grill.", "Banchan included."],
    });
    const firstDate = addDays(today, 30);
    const qualification = createFakeQualificationAdapter(
      new Map([
        [restaurant.providerPlaceId, operationalQuality(4.6, 150, firstDate)],
      ]),
    );
    const prepared1 = await prepareAndApprove(area, firstDate, qualification);
    const published1 = await publishRestaurantPickRun(
      prepared1.runId,
      moderator.id,
      {
        qualification,
      },
    );
    expect(published1.status).toBe("created");
    await withdrawRestaurantPick(
      published1.status === "created" ? published1.pickId : "",
      "test withdrawal, still consumes rotation",
      moderator.id,
    );

    // Simulate withdrawal after the scheduled date actually began.
    await pool.query(
      "UPDATE daily_pick SET withdrawn_at=($2::date + interval '12 hours') AT TIME ZONE 'America/Chicago' WHERE id=$1",
      [published1.status === "created" ? published1.pickId : "", firstDate],
    );
    const withinWindow = addDays(firstDate, 10); // < 30 days after
    const qualification2 = createFakeQualificationAdapter(
      new Map([
        [
          restaurant.providerPlaceId,
          operationalQuality(4.6, 150, withinWindow),
        ],
      ]),
    );
    const result = await prepareRestaurantPickRun(area, withinWindow, {
      qualification: qualification2,
      copy: createFakeCopyAdapter(),
    });
    expect(result.status).toBe("empty");
    if (result.status !== "empty") throw new Error("unreachable");
    expect(result.reason).toBe("no_eligible_candidates");
    const rows = await pool.query<{ all: string[] }>(
      "SELECT reason_codes AS all FROM daily_pick_run_candidate WHERE run_id=$1",
      [result.runId],
    );
    expect(rows.rows[0].all).toContain("restaurant_recent");
  });

  it("skips version 1 generation for a city with an enabled version 2 area, rather than bypassing it", async () => {
    const { results, errors } = await runDailyPickGeneration({
      citySlug: city.slug,
      date: addDays(today, 6),
    });
    expect(errors).toEqual([]);
    expect(results).toEqual([
      expect.objectContaining({
        city: city.slug,
        status: "skipped_v2_enabled",
        pickId: null,
      }),
    ]);
    const v1Rows = await pool.query(
      "SELECT id FROM daily_pick WHERE city_id=$1 AND pick_date=$2::date",
      [city.id, addDays(today, 6)],
    );
    expect(v1Rows.rows).toHaveLength(0);
  });

  it("refuses to prepare a run for a disabled area", async () => {
    const disabledArea: RestaurantArea = { ...area, enabled: false };
    await expect(
      prepareRestaurantPickRun(disabledArea, addDays(today, 5), {
        qualification: createFakeQualificationAdapter(new Map()),
        copy: createFakeCopyAdapter(),
      }),
    ).rejects.toThrow(/disabled area/);
  });

  it("fails closed without fresh Google data and preserves the reviewed draft", async () => {
    const date = addDays(today, 100);
    const restaurant = await insertCandidate({
      foodType: "pizza",
      facts: ["Wood-fired oven.", "House-made dough."],
    });
    const qualification = createFakeQualificationAdapter(
      new Map([
        [restaurant.providerPlaceId, operationalQuality(4.8, 150, date)],
      ]),
    );
    const prepared = await prepareAndApprove(area, date, qualification);
    const before = await pool.query(
      "SELECT * FROM daily_pick_run_candidate WHERE run_id=$1",
      [prepared.runId],
    );
    await expect(
      prepareRestaurantPickRun(area, date, {
        qualification,
        copy: createFakeCopyAdapter(),
      }),
    ).rejects.toThrow(/already leased/);
    const result = await publishRestaurantPickRun(
      prepared.runId,
      moderator.id,
      { qualification: createFakeQualificationAdapter(new Map()) },
    );
    expect(result).toMatchObject({
      status: "stale",
      reason: "quality_unknown",
    });
    expect(
      (
        await pool.query(
          "SELECT * FROM daily_pick_run_candidate WHERE run_id=$1",
          [prepared.runId],
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await pool.query("SELECT id FROM daily_pick WHERE run_id=$1", [
          prepared.runId,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("rechecks a candidate exclusion made while Google qualification is in flight", async () => {
    const date = addDays(today, 110);
    const restaurant = await insertCandidate({
      foodType: "pizza",
      facts: ["Wood-fired oven.", "House-made dough."],
    });
    const qualification = createFakeQualificationAdapter(
      new Map([
        [restaurant.providerPlaceId, operationalQuality(4.8, 150, date)],
      ]),
    );
    const prepared = await prepareAndApprove(area, date, qualification);
    const result = await publishRestaurantPickRun(
      prepared.runId,
      moderator.id,
      {
        qualification: {
          async fetchQuality(input) {
            await pool.query(
              "UPDATE restaurant_candidate SET state='excluded',updated_at=now() WHERE id=$1",
              [restaurant.candidateId],
            );
            return qualification.fetchQuality(input);
          },
        },
      },
    );
    expect(result).toMatchObject({
      status: "stale",
      reason: "evidence_or_review_changed",
    });
    expect(
      (
        await pool.query("SELECT id FROM daily_pick WHERE run_id=$1", [
          prepared.runId,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("serializes adjacent dates so concurrent workers cannot publish the same food type", async () => {
    const date = addDays(today, 120);
    const a = await insertCandidate({
      foodType: "pizza",
      facts: ["Wood-fired oven.", "House-made dough."],
    });
    const b = await insertCandidate({
      foodType: "pizza",
      facts: ["Brick oven.", "Sourdough base."],
    });
    const tomorrow = addDays(date, 1);
    const qa = createFakeQualificationAdapter(
      new Map([[a.providerPlaceId, operationalQuality(4.8, 150, date)]]),
    );
    const qb = createFakeQualificationAdapter(
      new Map([[b.providerPlaceId, operationalQuality(4.8, 150, tomorrow)]]),
    );
    const ra = await prepareAndApprove(area, date, qa);
    const rb = await prepareAndApprove(area, tomorrow, qb);
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    const gated = (
      q: RestaurantQualificationAdapter,
    ): RestaurantQualificationAdapter => ({
      async fetchQuality(input) {
        const result = await q.fetchQuality(input);
        if (++arrived === 2) release();
        await barrier;
        return result;
      },
    });
    const results = await Promise.all([
      publishRestaurantPickRun(ra.runId, moderator.id, {
        qualification: gated(qa),
      }),
      publishRestaurantPickRun(rb.runId, moderator.id, {
        qualification: gated(qb),
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["created", "stale"]);
    expect(results.find((r) => r.status === "stale")).toMatchObject({
      reason: "food_type_recent",
    });
  });

  it("auto-approves discovered restaurants with a mapped type and drafts template copy without facts", async () => {
    const date = addDays(today, 200);
    const ramenId = `auto-${suffix}-ramen`;
    const genericId = `auto-${suffix}-generic`;
    await pool.query(
      `UPDATE restaurant_discovery_area SET config=$2::jsonb WHERE id=$1`,
      [
        area.id,
        JSON.stringify({
          autoApproveDiscovered: true,
          requireEvidence: false,
          queryGroups: ["g1"],
          discoveryBudgetPerRun: 1,
        }),
      ],
    );
    const autoArea = (await loadRestaurantArea(pool, city.slug))!;
    try {
      const result = await prepareRestaurantPickRun(autoArea, date, {
        discovery: createFakeDiscoveryAdapter({
          g1: [
            {
              providerPlaceId: ramenId,
              label: "Ramen",
              primaryType: "ramen_restaurant",
            },
            {
              providerPlaceId: genericId,
              label: "Generic",
              primaryType: "restaurant",
            },
          ],
        }),
        qualification: createFakeQualificationAdapter(
          new Map([[ramenId, operationalQuality(4.7, 300, date)]]),
        ),
        copy: createFakeCopyAdapter(),
      });
      const rows = await pool.query<{
        provider_place_id: string;
        candidate_id: string;
        subject_id: string;
        state: string;
        food_type: string | null;
        food_type_source: string | null;
        city_review_status: string;
      }>(
        `SELECT r.provider_place_id, c.id AS candidate_id, s.id AS subject_id, c.state, c.food_type, c.food_type_source, s.city_review_status
         FROM place_provider_reference r
         JOIN place_subject s ON s.id=r.subject_id
         JOIN restaurant_candidate c ON c.subject_id=s.id AND c.area_id=$1
         WHERE r.provider_place_id = ANY($2::text[])`,
        [area.id, [ramenId, genericId]],
      );
      for (const r of rows.rows) {
        subjectIds.push(r.subject_id);
        candidateIds.push(r.candidate_id);
      }
      const byId = new Map(rows.rows.map((r) => [r.provider_place_id, r]));
      expect(byId.get(ramenId)).toMatchObject({
        state: "approved",
        food_type: "ramen",
        food_type_source: "provider",
        city_review_status: "approved",
      });
      expect(byId.get(genericId)).toMatchObject({
        state: "discovered",
        food_type: null,
        city_review_status: "unreviewed",
      });
      expect(result.status).toBe("ready_for_review");
      if (result.status !== "ready_for_review") return;
      expect(result.winnerSubjectId).toBe(byId.get(ramenId)!.subject_id);
      const copy = await pool.query<{
        prompt_version: string;
        review_status: string;
        en_sentences: { text: string }[];
      }>(
        "SELECT prompt_version, review_status, en_sentences FROM restaurant_copy WHERE id=$1",
        [result.copyId],
      );
      expect(copy.rows[0]).toMatchObject({
        prompt_version: "template-v1",
        review_status: "pending",
      });
      expect(copy.rows[0].en_sentences[0].text).toBe(
        `Today's pick is a ramen restaurant in ${city.name}.`,
      );
    } finally {
      await pool.query(
        `UPDATE restaurant_discovery_area SET config='{}'::jsonb WHERE id=$1`,
        [area.id],
      );
    }
  });

  it("stores the discovered name and updates it when the same place ID returns a new one", async () => {
    const placeId = `named-${suffix}`;
    await pool.query(
      `UPDATE restaurant_discovery_area SET config=$2::jsonb WHERE id=$1`,
      [
        area.id,
        JSON.stringify({ queryGroups: ["g1"], discoveryBudgetPerRun: 1 }),
      ],
    );
    const namedArea = (await loadRestaurantArea(pool, city.slug))!;
    const discover = (name: string | null) =>
      createFakeDiscoveryAdapter({
        g1: [{ providerPlaceId: placeId, label: name ?? placeId, name }],
      });
    const storedName = async () =>
      (
        await pool.query<{ display_name: string | null; subject_id: string }>(
          "SELECT display_name, subject_id FROM place_provider_reference WHERE provider_place_id=$1",
          [placeId],
        )
      ).rows[0];
    const prepare = (date: string, name: string | null) =>
      prepareRestaurantPickRun(namedArea, date, {
        discovery: discover(name),
        qualification: createFakeQualificationAdapter(new Map()),
        copy: createFakeCopyAdapter(),
      });
    try {
      await prepare(addDays(today, 300), "Old Noodle House");
      const first = await storedName();
      subjectIds.push(first.subject_id);
      const candidate = await pool.query<{ id: string }>(
        "SELECT id FROM restaurant_candidate WHERE area_id=$1 AND subject_id=$2",
        [area.id, first.subject_id],
      );
      candidateIds.push(candidate.rows[0].id);
      expect(first.display_name).toBe("Old Noodle House");

      await prepare(addDays(today, 301), "New Noodle House");
      expect((await storedName()).display_name).toBe("New Noodle House");
      const pool1 = await listCandidates(moderator, area.id);
      expect(pool1.find((c) => c.subjectId === first.subject_id)?.label).toBe(
        "New Noodle House",
      );

      await prepare(addDays(today, 302), null);
      expect((await storedName()).display_name).toBe("New Noodle House");
    } finally {
      await pool.query(
        `UPDATE restaurant_discovery_area SET config='{}'::jsonb WHERE id=$1`,
        [area.id],
      );
    }
  });
});
