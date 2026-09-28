import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  pool,
  ensureSystemLayers,
  createFakeCopyAdapter,
  createFakeQualificationAdapter,
  loadRestaurantArea,
  prepareRestaurantPickRun,
  workRestaurantJob,
  type RestaurantArea,
} from "../../packages/database/src";
import {
  addEvidence,
  approveCopy,
  curateCandidate,
  getRunDetail,
  listAreas,
  listCandidates,
  listRuns,
  publishRun,
  rejectCopy,
  setEvidenceApproval,
  withdrawPublishedPick,
} from "../../apps/web/src/features/restaurant-admin/service";
import { localDate, type Actor } from "../../packages/shared/src";
/*
 * Isolated fixtures: a throwaway city so other cities' areas/runs are
 * untouched. The provider place ID is a synthetic test string; no live
 * provider or model call is made anywhere in this file.
 */
const suffix = crypto.randomUUID().slice(0, 8);
const tz = "America/Chicago";
const city = {
  id: crypto.randomUUID(),
  slug: `ra-test-${suffix}`,
  name: "Restaurant Admin Test City",
  timezone: tz,
  latitude: 29.76,
  longitude: -95.37,
};
const moderator: Actor = { id: crypto.randomUUID(), role: "MODERATOR" };
const member: Actor = { id: crypto.randomUUID(), role: "USER" };
const today = localDate(new Date(), tz);
const providerPlaceId = `test-provider-${suffix}`;
let area: RestaurantArea;
let subjectId: string;
let candidateId: string;

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
  for (const actor of [moderator, member])
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [
        actor.id,
        "Restaurant Admin Tester",
        `${actor.id}@example.test`,
        actor.role,
      ],
    );
  await pool.query(
    `INSERT INTO restaurant_discovery_area(city_slug, layer_slug, timezone, config_version, config, enabled)
     VALUES($1,$2,$3,1,'{}'::jsonb,true)`,
    [city.slug, `discover-${city.slug}`, tz],
  );
  area = (await loadRestaurantArea(pool, city.slug))!;
  const subject = await pool.query<{ id: string }>(
    `INSERT INTO place_subject(city_id, city_review_status, city_reviewed_by, city_reviewed_at)
     VALUES($1,'approved',$2,now()) RETURNING id`,
    [city.id, moderator.id],
  );
  subjectId = subject.rows[0].id;
  await pool.query(
    `INSERT INTO place_provider_reference(subject_id, provider, provider_place_id) VALUES($1,'google',$2)`,
    [subjectId, providerPlaceId],
  );
  const candidate = await pool.query<{ id: string }>(
    `INSERT INTO restaurant_candidate(area_id, subject_id, state) VALUES($1,$2,'discovered') RETURNING id`,
    [area.id, subjectId],
  );
  candidateId = candidate.rows[0].id;
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
  await pool.query("UPDATE daily_pick SET copy_id=NULL WHERE city_id=$1", [
    city.id,
  ]);
  await pool.query(
    "DELETE FROM restaurant_copy WHERE run_id IN (SELECT id FROM daily_pick_run WHERE area_id=$1)",
    [area.id],
  );
  await pool.query("DELETE FROM daily_pick WHERE city_id=$1", [city.id]);
  await pool.query("DELETE FROM daily_pick_run WHERE area_id=$1", [area.id]);
  await pool.query("DELETE FROM restaurant_evidence WHERE candidate_id=$1", [
    candidateId,
  ]);
  await pool.query("DELETE FROM restaurant_candidate WHERE area_id=$1", [
    area.id,
  ]);
  await pool.query("DELETE FROM restaurant_discovery_area WHERE id=$1", [
    area.id,
  ]);
  await pool.query("DELETE FROM place_provider_reference WHERE subject_id=$1", [
    subjectId,
  ]);
  await pool.query("DELETE FROM place_subject WHERE id=$1", [subjectId]);
  await pool.query("DELETE FROM moderation_action WHERE actor_id=$1", [
    moderator.id,
  ]);
  await pool.query("DELETE FROM layer WHERE city_id=$1", [city.id]);
  await pool.query("DELETE FROM city WHERE id=$1", [city.id]);
  await pool.query('DELETE FROM "user" WHERE id = ANY($1::uuid[])', [
    [moderator.id, member.id],
  ]);
  await pool.end();
});

describe("Restaurant admin service", () => {
  it("denies every action to a non-moderator", async () => {
    await expect(listAreas(member)).rejects.toThrow();
    await expect(listCandidates(member, area.id)).rejects.toThrow();
    await expect(
      curateCandidate(member, area.id, candidateId, {
        expectedUpdatedAt: new Date().toISOString(),
        state: "approved",
      }),
    ).rejects.toThrow();
    await expect(listAreas(null)).rejects.toThrow();
  });

  it("lists the area and its candidate for a moderator", async () => {
    const areas = await listAreas(moderator);
    expect(areas.find((a) => a.id === area.id)).toBeTruthy();
    const candidates = await listCandidates(moderator, area.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: candidateId,
      state: "discovered",
    });
  });

  it("curates a candidate with optimistic concurrency", async () => {
    const before = await listCandidates(moderator, area.id);
    const expectedUpdatedAt = before[0].updatedAt;
    await curateCandidate(moderator, area.id, candidateId, {
      expectedUpdatedAt,
      state: "approved",
      foodType: "tacos",
      foodTypeVersion: 1,
    });
    const after = await listCandidates(moderator, area.id);
    expect(after[0]).toMatchObject({ state: "approved", foodType: "tacos" });

    // A stale expectedUpdatedAt is rejected, not silently overwritten.
    await expect(
      curateCandidate(moderator, area.id, candidateId, {
        expectedUpdatedAt,
        state: "excluded",
      }),
    ).rejects.toThrow(/REVISION_CONFLICT|changed since/);
  });

  it("adds and approves evidence", async () => {
    const first = await addEvidence(moderator, candidateId, {
      label: "Handmade tortillas made daily.",
    });
    const second = await addEvidence(moderator, candidateId, {
      label: "Weekend barbacoa special.",
    });
    expect(first.id).toBeTruthy();
    await setEvidenceApproval(moderator, second.id, true);
    const candidates = await listCandidates(moderator, area.id);
    expect(candidates[0].approvedEvidenceCount).toBeGreaterThanOrEqual(1);
  });

  it("runs prepare, then reviews and publishes through the admin service", async () => {
    const qualification = createFakeQualificationAdapter(
      new Map([
        [
          providerPlaceId,
          {
            rating: 4.6,
            ratingCount: 120,
            businessStatus: "OPERATIONAL",
            hoursByDate: new Map([
              [today, { date: today, periods: [{ open: 0, close: 1440 }] }],
            ]),
          },
        ],
      ]),
    );
    const prepared = await prepareRestaurantPickRun(area, today, {
      qualification,
      copy: createFakeCopyAdapter(),
    });
    expect(prepared.status).toBe("ready_for_review");
    if (prepared.status !== "ready_for_review") throw new Error("unreachable");

    const runs = await listRuns(moderator, area.id);
    expect(runs.find((r) => r.id === prepared.runId)).toBeTruthy();
    const detail = await getRunDetail(moderator, prepared.runId);
    expect(detail.copy?.reviewStatus).toBe("pending");
    expect(detail.report.some((r) => r.decision === "picked")).toBe(true);

    // Publishing before copy approval is rejected with a clear reason.
    await expect(publishRun(moderator, prepared.runId, {})).rejects.toThrow(
      /COPY_NOT_APPROVED|Approve the copy/,
    );

    await approveCopy(moderator, prepared.copyId);
    const queued = await publishRun(moderator, prepared.runId, {});
    expect(queued.status).toBe("queued");
    expect((await publishRun(moderator, prepared.runId, {})).jobId).toBe(
      queued.jobId,
    );
    const publishResult = await workRestaurantJob(area, {
      qualification,
      copy: createFakeCopyAdapter(),
    });
    expect(publishResult?.status).toBe("created");
    if (
      !publishResult ||
      publishResult.status !== "created" ||
      !("pickId" in publishResult)
    )
      throw new Error("unreachable");

    const pick = await pool.query<{ status: string }>(
      "SELECT status FROM daily_pick WHERE id=$1",
      [publishResult.pickId],
    );
    expect(pick.rows[0].status).toBe("published");

    await withdrawPublishedPick(moderator, publishResult.pickId, {
      reason: "test cleanup",
    });
    const withdrawn = await pool.query<{ status: string }>(
      "SELECT status FROM daily_pick WHERE id=$1",
      [publishResult.pickId],
    );
    expect(withdrawn.rows[0].status).toBe("withdrawn");
  });

  it("rejects copy with a reason and marks the run's copy_status rejected", async () => {
    // A fresh, separate candidate: the previous test's published-then-
    // withdrawn pick still consumes the 30-day restaurant-repeat window for
    // its own subject, so reusing it here would make this run legitimately
    // empty rather than ready_for_review.
    const otherProviderPlaceId = `test-provider-${suffix}-second`;
    const otherSubject = await pool.query<{ id: string }>(
      `INSERT INTO place_subject(city_id, city_review_status, city_reviewed_by, city_reviewed_at)
       VALUES($1,'approved',$2,now()) RETURNING id`,
      [city.id, moderator.id],
    );
    const otherSubjectId = otherSubject.rows[0].id;
    await pool.query(
      `INSERT INTO place_provider_reference(subject_id, provider, provider_place_id) VALUES($1,'google',$2)`,
      [otherSubjectId, otherProviderPlaceId],
    );
    const otherCandidate = await pool.query<{ id: string }>(
      `INSERT INTO restaurant_candidate(area_id, subject_id, state, food_type, food_type_version)
       VALUES($1,$2,'approved','ramen',1) RETURNING id`,
      [area.id, otherSubjectId],
    );
    await pool.query(
      `INSERT INTO restaurant_evidence(candidate_id, label, approved_for_copy, approved_by, approved_at)
       VALUES($1,'Tonkotsu broth simmered overnight.',true,$2,now()),
             ($1,'House-made noodles.',true,$2,now())`,
      [otherCandidate.rows[0].id, moderator.id],
    );
    const qualification = createFakeQualificationAdapter(
      new Map([
        [
          otherProviderPlaceId,
          {
            rating: 4.6,
            ratingCount: 120,
            businessStatus: "OPERATIONAL",
            hoursByDate: new Map([
              [today, { date: today, periods: [{ open: 0, close: 1440 }] }],
            ]),
          },
        ],
      ]),
    );
    const prepared = await prepareRestaurantPickRun(area, today, {
      qualification,
      copy: createFakeCopyAdapter(),
    });
    expect(prepared.status).toBe("ready_for_review");
    if (prepared.status !== "ready_for_review") throw new Error("unreachable");
    await rejectCopy(moderator, prepared.copyId, { reason: "needs rewrite" });
    const detail = await getRunDetail(moderator, prepared.runId);
    expect(detail.copy?.reviewStatus).toBe("rejected");
    expect(detail.copyStatus).toBe("rejected");

    await pool.query("DELETE FROM restaurant_copy WHERE candidate_id=$1", [
      otherCandidate.rows[0].id,
    ]);
    // This run's own report row references otherSubjectId; delete it before
    // the subject itself (afterAll's area-scoped cleanup runs too late for
    // that FK, since it happens only after every test in this file finishes).
    await pool.query("DELETE FROM daily_pick_run_candidate WHERE run_id=$1", [
      prepared.runId,
    ]);
    await pool.query("DELETE FROM restaurant_evidence WHERE candidate_id=$1", [
      otherCandidate.rows[0].id,
    ]);
    await pool.query("DELETE FROM restaurant_candidate WHERE id=$1", [
      otherCandidate.rows[0].id,
    ]);
    await pool.query(
      "DELETE FROM place_provider_reference WHERE subject_id=$1",
      [otherSubjectId],
    );
    await pool.query("DELETE FROM place_subject WHERE id=$1", [otherSubjectId]);
  });
});
