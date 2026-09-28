import { pool } from "@taiwanhub/database";
import {
  approveRestaurantCopy,
  enqueueRestaurantJob,
  rejectRestaurantCopy,
  withdrawRestaurantPick,
} from "@taiwanhub/database";
import { AppError, requireModerator, type Actor } from "@taiwanhub/shared";
import { z } from "zod";
import { patchSubject } from "../place-subjects/admin";
/** Moderator-only curation and durable worker jobs. No provider calls in HTTP requests. */
export async function listAreas(actor: Actor | null) {
  requireModerator(actor);
  const result = await pool.query<{
    id: string;
    city_slug: string;
    layer_slug: string;
    timezone: string;
    enabled: boolean;
    config_version: number;
    candidate_count: number;
    run_count: number;
  }>(
    `SELECT a.id, a.city_slug, a.layer_slug, a.timezone, a.enabled, a.config_version,
       (SELECT count(*)::int FROM restaurant_candidate c WHERE c.area_id=a.id) AS candidate_count,
       (SELECT count(*)::int FROM daily_pick_run r WHERE r.area_id=a.id) AS run_count
     FROM restaurant_discovery_area a ORDER BY a.city_slug`,
  );
  return result.rows.map((r) => ({
    id: r.id,
    citySlug: r.city_slug,
    layerSlug: r.layer_slug,
    timezone: r.timezone,
    enabled: r.enabled,
    configVersion: r.config_version,
    candidateCount: r.candidate_count,
    runCount: r.run_count,
  }));
}
async function requireArea(areaId: string) {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM restaurant_discovery_area WHERE id=$1",
    [areaId],
  );
  if (!result.rows[0])
    throw new AppError(404, "NOT_FOUND", "Unknown restaurant discovery area.");
}
export async function listCandidates(actor: Actor | null, areaId: string) {
  requireModerator(actor);
  await requireArea(areaId);
  const result = await pool.query<{
    id: string;
    subject_id: string;
    state: string;
    food_type: string | null;
    food_type_version: number | null;
    food_type_source: string | null;
    excluded_reason: string | null;
    label: string;
    provider_place_id: string | null;
    city_review_status: string;
    subject_status: string;
    subject_revision: number;
    evidence_count: number;
    approved_evidence_count: number;
    updated_at: Date;
  }>(
    `SELECT c.id, c.subject_id, c.state, c.food_type, c.food_type_version, c.food_type_source, c.excluded_reason, c.updated_at,
       COALESCE(p.name, 'Candidate ' || c.id::text) AS label,
       (SELECT r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) AS provider_place_id,
       s.city_review_status, s.status AS subject_status, s.revision AS subject_revision,
       (SELECT count(*)::int FROM restaurant_evidence e WHERE e.candidate_id=c.id) AS evidence_count,
       (SELECT count(*)::int FROM restaurant_evidence e WHERE e.candidate_id=c.id AND e.approved_for_copy) AS approved_evidence_count
     FROM restaurant_candidate c
     JOIN place_subject s ON s.id = c.subject_id
     LEFT JOIN place p ON p.id = s.catalog_place_id
     WHERE c.area_id = $1 ORDER BY c.created_at DESC`,
    [areaId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    subjectId: r.subject_id,
    state: r.state,
    foodType: r.food_type,
    foodTypeVersion: r.food_type_version,
    foodTypeSource: r.food_type_source,
    excludedReason: r.excluded_reason,
    label: r.label,
    providerPlaceId: r.provider_place_id,
    cityReviewStatus: r.city_review_status,
    subjectStatus: r.subject_status,
    subjectRevision: r.subject_revision,
    evidenceCount: r.evidence_count,
    approvedEvidenceCount: r.approved_evidence_count,
    updatedAt: r.updated_at.toISOString(),
  }));
}
const candidatePatchInput = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  state: z.enum(["reviewing", "approved", "excluded"]).optional(),
  foodType: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((v) => {
      const normalized = v.toLowerCase().replace(/\s+/g, " ");
      return (
        (
          {
            taco: "tacos",
            burger: "burgers",
            hamburger: "burgers",
            bbq: "barbecue",
            pizzas: "pizza",
          } as Record<string, string>
        )[normalized] ?? normalized
      );
    })
    .nullable()
    .optional(),
  foodTypeVersion: z.number().int().min(1).optional(),
  excludedReason: z.string().trim().max(500).optional(),
});
/** Moderator curation of one candidate: food type, review state, exclusion reason. Optimistic concurrency via updated_at. */
export async function curateCandidate(
  actor: Actor | null,
  areaId: string,
  candidateId: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  await requireArea(areaId);
  const input = candidatePatchInput.parse(body);
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (input.state !== undefined) {
    sets.push(`state=$${++i}`);
    values.push(input.state);
  }
  if (input.foodType !== undefined) {
    sets.push(`food_type=$${++i}`, `food_type_source='moderator'`);
    values.push(input.foodType);
  }
  if (input.foodTypeVersion !== undefined) {
    sets.push(`food_type_version=$${++i}`);
    values.push(input.foodTypeVersion);
  }
  if (input.excludedReason !== undefined) {
    sets.push(`excluded_reason=$${++i}`);
    values.push(input.excludedReason);
  }
  if (input.state !== undefined) {
    sets.push(`reviewed_by=$${++i}`, `reviewed_at=now()`);
    values.push(a.id);
  }
  if (!sets.length) throw new AppError(400, "NO_CHANGE", "Nothing to update.");
  // Compared at millisecond precision: `updatedAt` was serialized through
  // `Date.toISOString()` (millisecond precision) for the client, but the
  // stored timestamptz can carry microseconds, so a raw equality compare
  // would spuriously fail even when nothing changed.
  const result = await pool.query<{ id: string }>(
    `UPDATE restaurant_candidate SET ${sets.join(",")}, updated_at=now()
     WHERE id=$1 AND area_id=$${++i} AND date_trunc('milliseconds', updated_at)=$${++i}::timestamptz RETURNING id`,
    [candidateId, ...values, areaId, input.expectedUpdatedAt],
  );
  if (!result.rows[0])
    throw new AppError(
      409,
      "REVISION_CONFLICT",
      "This candidate changed since you loaded it. Reload and try again.",
    );
  return { id: candidateId };
}
const evidenceInput = z.object({
  label: z.string().trim().min(1).max(200),
  sourceUrl: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ })])
    .optional(),
});
/** A permission-compatible independent fact backing this candidate's recommendation, pre-approved by the adding moderator. */
export async function addEvidence(
  actor: Actor | null,
  candidateId: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  const input = evidenceInput.parse(body);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO restaurant_evidence(candidate_id, label, source_url, approved_for_copy, approved_by, approved_at)
     VALUES($1,$2,$3,true,$4,now()) RETURNING id`,
    [candidateId, input.label, input.sourceUrl || null, a.id],
  );
  return { id: result.rows[0].id };
}
export async function setEvidenceApproval(
  actor: Actor | null,
  evidenceId: string,
  approved: boolean,
) {
  const a = requireModerator(actor);
  const result = await pool.query<{ id: string }>(
    `UPDATE restaurant_evidence SET approved_for_copy=$2, approved_by=$3, approved_at=CASE WHEN $2 THEN now() ELSE approved_at END, revision=revision+1, updated_at=now()
     WHERE id=$1 RETURNING id`,
    [evidenceId, approved, a.id],
  );
  if (!result.rows[0])
    throw new AppError(404, "NOT_FOUND", "Unknown evidence.");
  return { id: result.rows[0].id };
}
export async function listRuns(actor: Actor | null, areaId: string) {
  requireModerator(actor);
  await requireArea(areaId);
  const result = await pool.query<{
    id: string;
    run_date: string;
    attempt: number;
    status: string;
    copy_status: string;
    error_code: string | null;
    final_pick_id: string | null;
    evaluated_count: number;
    eligible_count: number;
    excluded_count: number;
    created_at: Date;
  }>(
    `SELECT id, run_date::text AS run_date, attempt, status, copy_status, error_code, final_pick_id, evaluated_count, eligible_count, excluded_count, created_at
     FROM daily_pick_run WHERE area_id=$1 ORDER BY run_date DESC, attempt DESC LIMIT 100`,
    [areaId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    date: r.run_date,
    attempt: r.attempt,
    status: r.status,
    copyStatus: r.copy_status,
    errorCode: r.error_code,
    finalPickId: r.final_pick_id,
    evaluatedCount: r.evaluated_count,
    eligibleCount: r.eligible_count,
    excludedCount: r.excluded_count,
    createdAt: r.created_at.toISOString(),
  }));
}
/** The full top-10 report plus the pending/approved/rejected copy for one run's winner, if any. */
export async function getRunDetail(actor: Actor | null, runId: string) {
  requireModerator(actor);
  const run = await pool.query<{
    id: string;
    area_id: string;
    run_date: string;
    attempt: number;
    status: string;
    copy_status: string;
    error_code: string | null;
    final_pick_id: string | null;
  }>(
    `SELECT id, area_id, run_date::text AS run_date, attempt, status, copy_status, error_code, final_pick_id FROM daily_pick_run WHERE id=$1`,
    [runId],
  );
  if (!run.rows[0]) throw new AppError(404, "NOT_FOUND", "Unknown run.");
  const currentPick = await pool.query<{ id: string }>(
    `SELECT d.id FROM daily_pick d JOIN city c ON c.id=d.city_id JOIN restaurant_discovery_area a ON a.city_slug=c.slug WHERE a.id=$1 AND d.pick_date=$2 AND d.status='published'`,
    [run.rows[0].area_id, run.rows[0].run_date],
  );
  const report = await pool.query<{
    subject_id: string;
    candidate_label: string;
    base_rank: number;
    eligible_rank: number | null;
    report_position: number;
    decision: string;
    score: number | null;
    primary_reason_code: string;
    reason_codes: string[];
  }>(
    `SELECT rc.subject_id, COALESCE(p.name, 'Candidate') AS candidate_label, rc.base_rank, rc.eligible_rank, rc.report_position, rc.decision, rc.score, rc.primary_reason_code, rc.reason_codes
     FROM daily_pick_run_candidate rc
     JOIN place_subject s ON s.id = rc.subject_id
     LEFT JOIN place p ON p.id = s.catalog_place_id
     WHERE rc.run_id=$1 ORDER BY rc.report_position`,
    [runId],
  );
  const winner = report.rows.find((r) => r.decision === "picked");
  const copy = winner
    ? await pool.query<{
        id: string;
        review_status: string;
        en_sentences: { text: string; factIds: string[] }[];
        zh_sentences: { text: string; factIds: string[] }[];
        prompt_version: string;
        model_version: string;
      }>(
        `SELECT rc.id, rc.review_status, rc.en_sentences, rc.zh_sentences, rc.prompt_version, rc.model_version
         FROM restaurant_copy rc
         JOIN restaurant_candidate c ON c.id = rc.candidate_id
         WHERE rc.run_id=$1 AND c.subject_id=$2 ORDER BY rc.created_at DESC LIMIT 1`,
        [runId, winner.subject_id],
      )
    : null;
  return {
    id: run.rows[0].id,
    areaId: run.rows[0].area_id,
    date: run.rows[0].run_date,
    attempt: run.rows[0].attempt,
    status: run.rows[0].status,
    copyStatus: run.rows[0].copy_status,
    errorCode: run.rows[0].error_code,
    finalPickId: run.rows[0].final_pick_id,
    currentPickId: currentPick.rows[0]?.id ?? null,
    report: report.rows.map((r) => ({
      subjectId: r.subject_id,
      label: r.candidate_label,
      baseRank: r.base_rank,
      eligibleRank: r.eligible_rank,
      reportPosition: r.report_position,
      decision: r.decision,
      score: r.score,
      primaryReasonCode: r.primary_reason_code,
      reasonCodes: r.reason_codes,
    })),
    copy: copy?.rows[0]
      ? {
          id: copy.rows[0].id,
          reviewStatus: copy.rows[0].review_status,
          enSentences: copy.rows[0].en_sentences,
          zhSentences: copy.rows[0].zh_sentences,
          promptVersion: copy.rows[0].prompt_version,
          modelVersion: copy.rows[0].model_version,
        }
      : null,
  };
}
export async function approveCopy(actor: Actor | null, copyId: string) {
  const a = requireModerator(actor);
  await approveRestaurantCopy(copyId, a.id);
  return { id: copyId };
}
export async function rejectCopy(
  actor: Actor | null,
  copyId: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  const reason = z
    .object({ reason: z.string().trim().min(1).max(500) })
    .parse(body).reason;
  await rejectRestaurantCopy(copyId, a.id, reason);
  return { id: copyId };
}
const publishInput = z.object({
  expectedPickId: z.uuid().nullable().optional(),
});
export async function publishRun(
  actor: Actor | null,
  runId: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  const input = publishInput.parse(body);
  const run = await pool.query<{
    area_id: string;
    run_date: string;
    status: string;
  }>(`SELECT area_id,run_date::text,status FROM daily_pick_run WHERE id=$1`, [
    runId,
  ]);
  const row = run.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Unknown run.");
  const approved = await pool.query(
    "SELECT id FROM restaurant_copy WHERE run_id=$1 AND review_status='approved'",
    [runId],
  );
  if (!approved.rowCount)
    throw new AppError(
      409,
      "COPY_NOT_APPROVED",
      "Approve the copy before publishing.",
    );
  if (!["ready_for_review", "ready_to_publish"].includes(row.status))
    throw new AppError(409, "STALE", "This run is not ready to publish.");
  const result = await enqueueRestaurantJob({
    areaId: row.area_id,
    date: row.run_date,
    kind: "publish",
    runId,
    actorId: a.id,
    expectedPickId: input.expectedPickId,
  });
  return result;
}
const withdrawInput = z.object({ reason: z.string().trim().min(1).max(500) });
export async function withdrawPublishedPick(
  actor: Actor | null,
  pickId: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  const input = withdrawInput.parse(body);
  await withdrawRestaurantPick(pickId, input.reason, a.id);
  return { id: pickId };
}

export async function queuePreparation(
  actor: Actor | null,
  areaId: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  await requireArea(areaId);
  const { date } = z.object({ date: z.iso.date() }).parse(body);
  return enqueueRestaurantJob({ areaId, date, kind: "prepare", actorId: a.id });
}
export async function listJobs(actor: Actor | null, areaId: string) {
  requireModerator(actor);
  return (
    await pool.query(
      `SELECT id,kind,status,run_date::text AS date,result FROM restaurant_job WHERE area_id=$1 ORDER BY created_at DESC LIMIT 25`,
      [areaId],
    )
  ).rows;
}
export async function cancelRun(actor: Actor | null, runId: string) {
  requireModerator(actor);
  const canceled = await pool.query(
    `UPDATE daily_pick_run SET status='canceled',updated_at=now() WHERE id=$1 AND status IN ('ready_for_review','ready_to_publish') RETURNING id`,
    [runId],
  );
  if (!canceled.rowCount)
    throw new AppError(
      409,
      "CONFLICT",
      "Only an unpublished review draft can be discarded.",
    );
  return { id: runId };
}
export async function confirmCandidateArea(
  actor: Actor | null,
  areaId: string,
  candidateId: string,
  body: unknown,
) {
  requireModerator(actor);
  const input = z
    .object({
      expectedRevision: z.number().int().min(1),
      reason: z.string().trim().min(1).max(500),
    })
    .parse(body);
  const row = await pool.query<{ subject_id: string; city_id: string }>(
    `SELECT c.subject_id,city.id AS city_id FROM restaurant_candidate c JOIN restaurant_discovery_area a ON a.id=c.area_id JOIN city ON city.slug=a.city_slug WHERE c.id=$1 AND c.area_id=$2`,
    [candidateId, areaId],
  );
  if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "Unknown candidate.");
  return patchSubject(actor, row.rows[0].subject_id, {
    cityId: row.rows[0].city_id,
    ...input,
  });
}
