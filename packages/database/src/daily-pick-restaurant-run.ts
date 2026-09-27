import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./index";
import { lockDailyPickSlot } from "./daily-pick";
import {
  addDays,
  buildRestaurantReport,
  qualifyRestaurantCandidate,
  rankCandidates,
  restaurantRuleConfigSchema,
  restaurantRuleDefaults,
  stableHash,
  validateRestaurantCopy,
  zonedMidnight,
  type CommittedFeature,
  type CopyAttemptOutcome,
  type RestaurantCandidateInput,
  type RestaurantCopyOutput,
  type RestaurantRuleConfig,
} from "../../shared/src";
import type {
  DiscoveredRestaurant,
  RestaurantCopyAdapter,
  RestaurantDiscoveryAdapter,
  RestaurantQualificationAdapter,
  RestaurantQualitySnapshot,
} from "./restaurant-providers";

/**
 * Worker orchestration for the daily restaurant recommendation (version 2).
 * See docs/plans/daily-restaurant-recommendation-implementation-plan.md
 * sections 4, 5, 8 and docs/adr/daily-restaurant-recommendation-phase0.md
 * (pending) for the policy this must stay inside.
 *
 * The pipeline is split into two independently-callable stages, matching the
 * plan's `queued -> ... -> ready_for_review -> ready_to_publish -> published`
 * lifecycle:
 *
 * - `prepareRestaurantPickRun` claims a leased run, discovers/upserits
 *   candidates, qualifies and ranks them, attempts grounded copy, and writes
 *   the report. It NEVER publishes: a run can only reach `ready_for_review`
 *   (with a pending, unreviewed `restaurant_copy` row), `empty`, or `failed`.
 *   This is true regardless of which adapters (fake or real) are passed in,
 *   so a fake-adapter run cannot become a live recommendation by omission —
 *   there is no code path from "prepare" straight to "published".
 * - `publishRestaurantPickRun` is the only function that can publish, and it
 *   refuses unless a human has already called `approveRestaurantCopy` for
 *   that run's copy. It re-fetches fresh qualification data and re-validates
 *   every hard gate against fresh DB state inside a single atomic
 *   transaction before committing.
 */
export type RestaurantArea = {
  id: string;
  citySlug: string;
  layerSlug: string;
  timezone: string;
  configVersion: number;
  config: Record<string, unknown>;
  enabled: boolean;
};

export async function loadRestaurantArea(
  client: PoolClient | typeof pool,
  citySlug: string,
): Promise<RestaurantArea | null> {
  const result = await client.query<{
    id: string;
    city_slug: string;
    layer_slug: string;
    timezone: string;
    config_version: number;
    config: Record<string, unknown>;
    enabled: boolean;
  }>(
    `SELECT id,city_slug,layer_slug,timezone,config_version,config,enabled FROM restaurant_discovery_area WHERE city_slug=$1`,
    [citySlug],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    citySlug: row.city_slug,
    layerSlug: row.layer_slug,
    timezone: row.timezone,
    configVersion: row.config_version,
    config: row.config,
    enabled: row.enabled,
  };
}

/** Operator-tunable rule thresholds layered onto the shared defaults from `area.config`. */
export function areaRuleConfig(area: RestaurantArea): RestaurantRuleConfig {
  const overrides = restaurantRuleConfigSchema.partial().safeParse(area.config);
  return restaurantRuleConfigSchema.parse({
    ...restaurantRuleDefaults,
    ...(overrides.success ? overrides.data : {}),
  });
}
/** Bounded discovery/qualification request budgets, from `area.config`. */
const areaBudgetSchema = z.object({
  queryGroups: z.array(z.string().min(1)).default([]),
  discoveryBudgetPerRun: z.number().int().min(0).default(0),
  qualificationBudgetPerRun: z.number().int().min(0).default(200),
});
function areaBudgets(area: RestaurantArea) {
  const parsed = areaBudgetSchema.safeParse(area.config);
  return parsed.success
    ? parsed.data
    : {
        queryGroups: [],
        discoveryBudgetPerRun: 0,
        qualificationBudgetPerRun: 200,
      };
}

const terminalRunStatuses = [
  "published",
  "empty",
  "failed",
  "superseded",
  "canceled",
] as const;
const leaseDurationMs = 10 * 60_000;

export class RunLeaseLost extends Error {
  constructor(runId: string) {
    super(`Lost the run lease for ${runId}; another worker reclaimed it.`);
  }
}
export class RunBusy extends Error {
  constructor(public runId: string) {
    super(`Run ${runId} is already leased by another worker.`);
  }
}

type ClaimedRun = { runId: string; attempt: number; leaseOwner: string };
/**
 * Claim (or reclaim, if the previous lease expired) the run for this
 * area/date, serialized by an advisory lock so concurrent workers cannot both
 * insert a new attempt. Returns null if the current attempt is leased and
 * still active elsewhere (`RunBusy` is thrown instead so the caller sees the
 * runId to report/monitor).
 */
async function claimRestaurantRun(
  area: RestaurantArea,
  date: string,
  leaseOwner: string,
  now: Date,
): Promise<ClaimedRun> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `daily_pick_run_claim:${area.id}:${date}`,
    ]);
    const latest = await client.query<{
      id: string;
      attempt: number;
      status: string;
      lease_owner: string | null;
      lease_expires_at: Date | null;
    }>(
      `SELECT id, attempt, status, lease_owner, lease_expires_at FROM daily_pick_run
       WHERE area_id=$1 AND run_date=$2::date ORDER BY attempt DESC LIMIT 1 FOR UPDATE`,
      [area.id, date],
    );
    const row = latest.rows[0];
    const isTerminal = (status: string) =>
      (terminalRunStatuses as readonly string[]).includes(status);
    if (!row || isTerminal(row.status)) {
      const inserted = await client.query<{ id: string; attempt: number }>(
        `INSERT INTO daily_pick_run(area_id, run_date, attempt, status, config_version, rules_config, lease_owner, lease_expires_at)
         VALUES($1,$2::date,$3,'discovering',$4,'{}'::jsonb,$5,$6)
         RETURNING id, attempt`,
        [
          area.id,
          date,
          (row?.attempt ?? 0) + 1,
          area.configVersion,
          leaseOwner,
          new Date(now.getTime() + leaseDurationMs),
        ],
      );
      await client.query("COMMIT");
      return {
        runId: inserted.rows[0].id,
        attempt: inserted.rows[0].attempt,
        leaseOwner,
      };
    }
    const leaseActive =
      row.lease_owner && row.lease_expires_at && row.lease_expires_at > now;
    if (leaseActive && row.lease_owner !== leaseOwner) {
      await client.query("COMMIT");
      throw new RunBusy(row.id);
    }
    // Reclaim: either unleased, expired, or already ours. Reset to the start
    // of evaluation so a recovered worker never trusts a half-written report.
    await client.query(
      `UPDATE daily_pick_run SET status='discovering', lease_owner=$2, lease_expires_at=$3, error_code=NULL, updated_at=now() WHERE id=$1`,
      [row.id, leaseOwner, new Date(now.getTime() + leaseDurationMs)],
    );
    await client.query(`DELETE FROM daily_pick_run_candidate WHERE run_id=$1`, [
      row.id,
    ]);
    await client.query("COMMIT");
    return { runId: row.id, attempt: row.attempt, leaseOwner };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function renewLease(runId: string, leaseOwner: string, now: Date) {
  const result = await pool.query<{ id: string }>(
    `UPDATE daily_pick_run SET lease_expires_at=$3, updated_at=now()
     WHERE id=$1 AND lease_owner=$2 AND status <> ALL($4::text[]) RETURNING id`,
    [
      runId,
      leaseOwner,
      new Date(now.getTime() + leaseDurationMs),
      terminalRunStatuses,
    ],
  );
  if (!result.rows[0]) throw new RunLeaseLost(runId);
}

async function setRunStatus(
  runId: string,
  leaseOwner: string,
  fields: {
    status: string;
    errorCode?: string | null;
    evaluatedCount?: number;
    eligibleCount?: number;
    excludedCount?: number;
  },
) {
  await pool.query(
    `UPDATE daily_pick_run SET status=$2, error_code=$3,
       evaluated_count=COALESCE($4, evaluated_count),
       eligible_count=COALESCE($5, eligible_count),
       excluded_count=COALESCE($6, excluded_count),
       updated_at=now()
     WHERE id=$1 AND lease_owner=$7`,
    [
      runId,
      fields.status,
      fields.errorCode ?? null,
      fields.evaluatedCount ?? null,
      fields.eligibleCount ?? null,
      fields.excludedCount ?? null,
      leaseOwner,
    ],
  );
}

/**
 * Broad, non-cuisine-specific discovery for one run: rotates through the
 * area's configured query groups up to its per-run request budget, upserting
 * each found place into a subject/provider-reference/candidate row. A
 * discovered candidate starts in `state='discovered'` — never automatically
 * public or eligible; a moderator still has to approve it (see
 * restaurant_candidate.state). A missing adapter (no discovery configured
 * yet) or an empty query-group list is a no-op, not an error: evaluation
 * still proceeds against whatever candidates are already approved.
 */
async function discoverCandidates(
  area: RestaurantArea,
  runId: string,
  discovery: RestaurantDiscoveryAdapter | undefined,
  now: Date,
) {
  const budgets = areaBudgets(area);
  if (
    !discovery ||
    budgets.discoveryBudgetPerRun <= 0 ||
    !budgets.queryGroups.length
  )
    return;
  let requestCount = 0;
  let discoveredCount = 0;
  const errors: { queryGroup: string; message: string }[] = [];
  for (const queryGroup of budgets.queryGroups) {
    if (requestCount >= budgets.discoveryBudgetPerRun) break;
    requestCount += 1;
    try {
      const outcome = await discovery.discover({
        areaId: area.id,
        queryGroup,
        pageToken: null,
      });
      for (const found of outcome.found) {
        const upserted = await upsertDiscoveredCandidate(area.id, found);
        if (upserted) discoveredCount += 1;
      }
    } catch (error) {
      errors.push({
        queryGroup,
        message: error instanceof Error ? error.message : "discovery failed",
      });
    }
  }
  await pool.query(
    `INSERT INTO restaurant_discovery_run(area_id, run_date, attempt, status, request_count, discovered_count, errors)
     VALUES($1,(SELECT run_date FROM daily_pick_run WHERE id=$2),
       COALESCE((SELECT max(attempt) FROM restaurant_discovery_run WHERE area_id=$1 AND run_date=(SELECT run_date FROM daily_pick_run WHERE id=$2)),0)+1,
       $3,$4,$5,$6::jsonb)`,
    [
      area.id,
      runId,
      errors.length === 0
        ? "success"
        : errors.length === budgets.queryGroups.length
          ? "failed"
          : "partial",
      requestCount,
      discoveredCount,
      JSON.stringify(errors),
    ],
  );
  void now;
}

async function upsertDiscoveredCandidate(
  areaId: string,
  found: DiscoveredRestaurant,
): Promise<boolean> {
  const existingRef = await pool.query<{ subject_id: string }>(
    `SELECT subject_id FROM place_provider_reference WHERE provider='google' AND provider_place_id=$1 AND state='current'`,
    [found.providerPlaceId],
  );
  let subjectId = existingRef.rows[0]?.subject_id;
  if (!subjectId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const subject = await client.query<{ id: string }>(
        "INSERT INTO place_subject DEFAULT VALUES RETURNING id",
      );
      subjectId = subject.rows[0].id;
      const ref = await client.query(
        `INSERT INTO place_provider_reference(subject_id,provider,provider_place_id) VALUES($1,'google',$2)
         ON CONFLICT (provider,provider_place_id) DO NOTHING`,
        [subjectId, found.providerPlaceId],
      );
      if (!ref.rowCount) {
        await client.query("ROLLBACK");
        const winner = await pool.query<{ subject_id: string }>(
          `SELECT subject_id FROM place_provider_reference WHERE provider='google' AND provider_place_id=$1 AND state='current'`,
          [found.providerPlaceId],
        );
        subjectId = winner.rows[0]?.subject_id;
      } else {
        await client.query("COMMIT");
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  if (!subjectId) return false;
  const candidate = await pool.query(
    `INSERT INTO restaurant_candidate(area_id, subject_id, state) VALUES($1,$2,'discovered')
     ON CONFLICT (area_id, subject_id) DO NOTHING RETURNING id`,
    [areaId, subjectId],
  );
  return Boolean(candidate.rowCount);
}

type CandidateRow = {
  candidate_id: string;
  subject_id: string;
  provider_place_id: string | null;
  food_type: string | null;
  food_type_version: number | null;
  label: string;
  subject_active: boolean;
  subject_updated_at: string;
  city_review_status: string;
  in_area: boolean;
  catalog_place_id: string | null;
  catalog_status: string | null;
  catalog_is_demo: boolean | null;
  candidate_updated_at: string;
  evidence: {
    id: string;
    label: string;
    sourceUrl: string | null;
    approvedAt: string | null;
  }[];
};
const candidateSelect = `
  SELECT c.id AS candidate_id, c.subject_id, c.food_type, c.food_type_version, c.updated_at AS candidate_updated_at,
     s.status = 'active' AS subject_active, s.city_review_status, s.updated_at AS subject_updated_at,
     (s.city_id IS NOT NULL AND EXISTS (SELECT 1 FROM restaurant_discovery_area a WHERE a.id=c.area_id AND a.city_slug=(SELECT slug FROM city WHERE id=s.city_id))) AS in_area,
     s.catalog_place_id, p.status AS catalog_status, p.is_demo AS catalog_is_demo,
     (SELECT r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) AS provider_place_id,
     COALESCE(p.name, 'Candidate ' || c.id::text) AS label,
     COALESCE(
       (SELECT jsonb_agg(jsonb_build_object('id', e.id::text, 'label', e.label, 'sourceUrl', e.source_url, 'approvedAt', e.approved_at) ORDER BY e.id)
        FROM restaurant_evidence e WHERE e.candidate_id = c.id AND e.approved_for_copy),
       '[]'::jsonb
     ) AS evidence
   FROM restaurant_candidate c
   JOIN place_subject s ON s.id = c.subject_id
   LEFT JOIN place p ON p.id = s.catalog_place_id`;
/**
 * Reviewer-approved candidates only: discovery may create an unreviewed
 * subject, but publication requires an active, city-reviewed subject in the
 * area's own city, and (if linked to a catalog place at all) an approved,
 * non-demo catalog place. A hidden/rejected/demo linked place, or a subject
 * whose city no longer matches this area, can never publish through this
 * query — `visibility` in toCandidateInput derives directly from these
 * fields rather than assuming them.
 */
export async function loadApprovedCandidates(
  client: PoolClient | typeof pool,
  areaId: string,
): Promise<CandidateRow[]> {
  const result = await client.query<CandidateRow>(
    `${candidateSelect} WHERE c.area_id = $1 AND c.state = 'approved' ORDER BY c.id`,
    [areaId],
  );
  return result.rows;
}
async function loadCandidate(
  client: PoolClient | typeof pool,
  candidateId: string,
): Promise<CandidateRow | null> {
  const result = await client.query<CandidateRow>(
    `${candidateSelect} WHERE c.id = $1`,
    [candidateId],
  );
  return result.rows[0] ?? null;
}

/**
 * Every consuming historical feature in the area's city: published and
 * withdrawn version 2 picks, plus backfilled version 1 history (see
 * migration 0017) — withdrawal never resets rotation, and legacy history
 * with no classified food type still consumes the 30-day restaurant-repeat
 * window even though it can never produce a food-type-recent conflict.
 */
export async function loadCommittedFeatures(
  client: PoolClient | typeof pool,
  areaId: string,
  excludePickId: string | null,
): Promise<CommittedFeature[]> {
  const rows = await client.query<{
    pick_date: string;
    subject_id: string;
    food_type: string | null;
    id: string;
  }>(
    `SELECT d.pick_date::text AS pick_date, d.subject_id, d.food_type, d.id
     FROM daily_pick d
     JOIN city c ON c.id = d.city_id
     JOIN restaurant_discovery_area a ON a.city_slug = c.slug
     WHERE a.id = $1 AND d.status IN ('published','withdrawn') AND d.subject_id IS NOT NULL
       AND ($2::uuid IS NULL OR d.id <> $2)`,
    [areaId, excludePickId],
  );
  return rows.rows.map((r) => ({
    date: r.pick_date,
    canonicalId: r.subject_id,
    foodType: r.food_type,
    pickId: r.id,
  }));
}

/** A compact, stable fingerprint of exactly the fields that would change a fresh evaluation's outcome. */
function candidateFingerprint(row: CandidateRow): string {
  return String(
    stableHash(
      JSON.stringify([
        row.subject_active,
        row.city_review_status,
        row.in_area,
        row.catalog_place_id,
        row.catalog_status,
        row.catalog_is_demo,
        row.food_type,
        row.food_type_version,
        row.evidence.map((e) => [e.id, e.approvedAt]),
      ]),
    ),
  );
}

function toCandidateInput(
  row: CandidateRow,
  quality: RestaurantQualitySnapshot,
  timeZone: string,
): RestaurantCandidateInput {
  const catalogLinked = row.catalog_place_id != null;
  return {
    subjectId: row.subject_id,
    canonicalId: row.subject_id,
    foodType: row.food_type,
    foodTypeVersion: row.food_type_version,
    visibility: {
      active: row.subject_active,
      isDemo: catalogLinked ? Boolean(row.catalog_is_demo) : false,
      inGreaterHouston: row.in_area,
      catalogApproved:
        row.city_review_status === "approved" &&
        (!catalogLinked ||
          (row.catalog_status === "approved" && !row.catalog_is_demo)),
    },
    quality: {
      rating: quality.rating,
      ratingCount: quality.ratingCount,
      businessStatus: quality.businessStatus,
      retrievedAt: quality.retrievedAt,
    },
    hoursByDate: quality.hoursByDate,
    timeZone,
    hasIndependentEvidence: row.evidence.length >= 2,
  };
}

export type PrepareRunOutcome =
  | {
      status: "ready_for_review";
      runId: string;
      winnerSubjectId: string;
      copyId: string;
    }
  | { status: "empty"; runId: string; reason: string }
  | { status: "failed"; runId: string; errorCode: string };

/**
 * Discover, qualify, rank, attempt copy, and write the report. Never
 * publishes: the only reachable terminal states here are `ready_for_review`
 * (a pending, unapproved `restaurant_copy` row exists), `empty`, or `failed`.
 * Safe to call repeatedly for the same area/date: a non-terminal previous
 * attempt is reclaimed (its lease renewed) rather than starting a fresh
 * attempt, and a terminal `published` run is left untouched by the caller
 * (see runDailyPickRestaurantIfNeeded for the idempotent wrapper).
 */
export async function prepareRestaurantPickRun(
  area: RestaurantArea,
  date: string,
  adapters: {
    discovery?: RestaurantDiscoveryAdapter;
    qualification: RestaurantQualificationAdapter;
    copy: RestaurantCopyAdapter;
  },
  options: { now?: Date; leaseOwner?: string } = {},
): Promise<PrepareRunOutcome> {
  const now = options.now ?? new Date();
  if (!area.enabled)
    throw new Error(
      `Refusing to run a restaurant pick for a disabled area (${area.citySlug}). Enable it explicitly once Phase 0 is approved.`,
    );
  const config = areaRuleConfig(area);
  const leaseOwner = options.leaseOwner ?? `prepare:${crypto.randomUUID()}`;
  const { runId } = await claimRestaurantRun(area, date, leaseOwner, now);

  try {
    await discoverCandidates(area, runId, adapters.discovery, now);
    await renewLease(runId, leaseOwner, now);

    const candidates = await loadApprovedCandidates(pool, area.id);
    const committed = await loadCommittedFeatures(pool, area.id, null);
    const budgets = areaBudgets(area);

    const inputs: RestaurantCandidateInput[] = [];
    let qualificationFailures = 0;
    let qualificationCalls = 0;
    for (const row of candidates) {
      let quality: RestaurantQualitySnapshot;
      if (!row.provider_place_id) {
        quality = {
          rating: null,
          ratingCount: null,
          businessStatus: null,
          hoursByDate: new Map(),
          retrievedAt: now,
        };
      } else if (qualificationCalls >= budgets.qualificationBudgetPerRun) {
        // Budget exhausted: treat as unknown quality, never as a failure.
        quality = {
          rating: null,
          ratingCount: null,
          businessStatus: null,
          hoursByDate: new Map(),
          retrievedAt: now,
        };
      } else {
        qualificationCalls += 1;
        try {
          quality = await adapters.qualification.fetchQuality({
            providerPlaceId: row.provider_place_id,
            dates: [addDays(date, -1), date],
          });
        } catch {
          qualificationFailures += 1;
          quality = {
            rating: null,
            ratingCount: null,
            businessStatus: null,
            hoursByDate: new Map(),
            retrievedAt: now,
          };
        }
      }
      inputs.push(toCandidateInput(row, quality, area.timezone));
    }
    // Every qualification call failed (not merely "quality unknown" for a
    // subset): this is a transport/auth/quota outage, not an honest empty
    // pool, and must not silently masquerade as "no eligible candidates".
    if (
      qualificationCalls > 0 &&
      qualificationFailures === qualificationCalls
    ) {
      await setRunStatus(runId, leaseOwner, {
        status: "failed",
        errorCode: "qualification_unavailable",
      });
      return {
        status: "failed",
        runId,
        errorCode: "qualification_unavailable",
      };
    }
    await renewLease(runId, leaseOwner, now);

    const candidateById = new Map(candidates.map((c) => [c.subject_id, c]));
    const copyRecords = new Map<
      string,
      { output: RestaurantCopyOutput; approvedFactIds: Set<string> }
    >();
    const copyOutcomes = new Map<string, CopyAttemptOutcome>();
    const attemptCopy = (input: RestaurantCandidateInput): CopyAttemptOutcome =>
      copyOutcomes.get(input.subjectId) ?? "copy_failed";
    const ranked = rankCandidates(inputs, area.id, date, config);
    const eligibleInOrder = ranked.filter(
      (r) =>
        qualifyRestaurantCandidate(r.candidate, date, now, committed, config)
          .qualified,
    );
    let attempts = 0;
    for (const { candidate: input } of eligibleInOrder) {
      if (attempts >= config.maxCopyAttempts) break;
      attempts += 1;
      const row = candidateById.get(input.subjectId)!;
      try {
        const output = await adapters.copy.generate({
          candidateLabel: row.label,
          foodType: input.foodType ?? "restaurant",
          evidence: row.evidence.map((e) => ({
            id: e.id,
            label: e.label,
            sourceUrl: e.sourceUrl ?? undefined,
          })),
          promptVersion: "v1",
        });
        const approvedFactIds = new Set(row.evidence.map((e) => e.id));
        const validation = validateRestaurantCopy(output, approvedFactIds);
        if (!validation.valid) {
          copyOutcomes.set(input.subjectId, "copy_failed");
          continue;
        }
        copyRecords.set(input.subjectId, { output, approvedFactIds });
        copyOutcomes.set(input.subjectId, "grounded");
        break;
      } catch {
        copyOutcomes.set(input.subjectId, "copy_failed");
      }
    }

    const outcome = buildRestaurantReport(
      inputs,
      area.id,
      date,
      now,
      committed,
      attemptCopy,
      config,
    );

    await pool.query(`DELETE FROM daily_pick_run_candidate WHERE run_id = $1`, [
      runId,
    ]);
    for (const row of outcome.report) {
      const candidateRow = candidateById.get(row.subjectId);
      const fingerprint =
        row.decision === "picked" && candidateRow
          ? candidateFingerprint(candidateRow)
          : null;
      await pool.query(
        `INSERT INTO daily_pick_run_candidate(run_id, subject_id, base_rank, eligible_rank, report_position, decision, score, primary_reason_code, reason_codes, fingerprint)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [
          runId,
          row.subjectId,
          row.baseRank,
          row.eligibleRank,
          row.reportPosition,
          row.decision,
          row.score,
          row.primaryReasonCode,
          JSON.stringify(row.allReasonCodes),
          fingerprint,
        ],
      );
    }

    if (outcome.status === "empty") {
      await setRunStatus(runId, leaseOwner, {
        status: "empty",
        errorCode: outcome.reason,
        evaluatedCount: outcome.evaluatedCount,
        eligibleCount: outcome.evaluatedCount - outcome.excludedCount,
        excludedCount: outcome.excludedCount,
      });
      return { status: "empty", runId, reason: outcome.reason };
    }

    const winnerRow = candidateById.get(outcome.winnerSubjectId)!;
    const copyRecord = copyRecords.get(outcome.winnerSubjectId)!;
    const copyInsert = await pool.query<{ id: string }>(
      `INSERT INTO restaurant_copy(candidate_id, run_id, en_sentences, zh_sentences, prompt_version, model_version, review_status)
       VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,'pending') RETURNING id`,
      [
        winnerRow.candidate_id,
        runId,
        JSON.stringify(copyRecord.output.enSentences),
        JSON.stringify(copyRecord.output.zhSentences),
        copyRecord.output.promptVersion,
        copyRecord.output.modelVersion,
      ],
    );
    await setRunStatus(runId, leaseOwner, {
      status: "ready_for_review",
      evaluatedCount: outcome.evaluatedCount,
      eligibleCount: outcome.evaluatedCount - outcome.excludedCount,
      excludedCount: outcome.excludedCount,
    });
    return {
      status: "ready_for_review",
      runId,
      winnerSubjectId: outcome.winnerSubjectId,
      copyId: copyInsert.rows[0].id,
    };
  } catch (error) {
    if (!(error instanceof RunLeaseLost)) {
      await setRunStatus(runId, leaseOwner, {
        status: "failed",
        errorCode: "unexpected_error",
      }).catch(() => {});
    }
    throw error;
  }
}

/** A moderator's explicit approval; required before `publishRestaurantPickRun` can commit. */
export async function approveRestaurantCopy(copyId: string, actorId: string) {
  const result = await pool.query<{ id: string }>(
    `UPDATE restaurant_copy SET review_status='approved', reviewed_by=$2, reviewed_at=now(), updated_at=now()
     WHERE id=$1 AND review_status='pending' RETURNING id`,
    [copyId, actorId],
  );
  if (!result.rows[0])
    throw new Error(
      `Copy ${copyId} is not pending review (already approved/rejected, or does not exist).`,
    );
}
export async function rejectRestaurantCopy(
  copyId: string,
  actorId: string,
  reason: string,
) {
  const result = await pool.query<{ run_id: string }>(
    `UPDATE restaurant_copy SET review_status='rejected', reviewed_by=$2, reviewed_at=now(), updated_at=now()
     WHERE id=$1 AND review_status='pending' RETURNING run_id`,
    [copyId, actorId],
  );
  if (!result.rows[0])
    throw new Error(
      `Copy ${copyId} is not pending review (already approved/rejected, or does not exist).`,
    );
  await pool.query(
    `UPDATE daily_pick_run SET copy_status='rejected', updated_at=now() WHERE id=$1`,
    [result.rows[0].run_id],
  );
  void reason;
}

export type PublishOutcome =
  | {
      status: "created" | "replaced";
      runId: string;
      pickId: string;
      subjectId: string;
    }
  | { status: "unchanged"; runId: string; pickId: string }
  | { status: "revision_conflict"; runId: string; currentPickId: string }
  | { status: "copy_not_approved"; runId: string }
  | { status: "stale"; runId: string; reason: string };

/**
 * The only function that can publish a version 2 pick. Requires the run's
 * copy to already be human-approved. Fetches fresh qualification data
 * outside any lock, then re-validates every hard gate against fresh DB state
 * (subject/candidate/evidence/catalog, committed history, and the fresh
 * quality snapshot) inside one short transaction alongside the shared
 * version 1 slot lock, the area lock, the pick insert, the Discover
 * membership (skipped for an already catalog-linked subject, to avoid a
 * duplicate map/list row), the audit trail, and the run's own final status —
 * all atomically. `expectedPickId` must match the currently published pick
 * (if any) to confirm an intentional replace; omitting it while a different
 * pick is already published returns `revision_conflict` instead of silently
 * overwriting it.
 */
export async function publishRestaurantPickRun(
  runId: string,
  actorId: string | null,
  adapters: { qualification: RestaurantQualificationAdapter },
  options: { expectedPickId?: string | null; now?: Date } = {},
): Promise<PublishOutcome> {
  const now = options.now ?? new Date();
  const run = await pool.query<{
    id: string;
    area_id: string;
    run_date: string;
    status: string;
    final_pick_id: string | null;
  }>(
    `SELECT id, area_id, run_date::text AS run_date, status, final_pick_id FROM daily_pick_run WHERE id=$1`,
    [runId],
  );
  const runRow = run.rows[0];
  if (!runRow) throw new Error(`Unknown run: ${runId}`);
  if (runRow.status === "published")
    return {
      status: "unchanged",
      runId,
      pickId: runRow.final_pick_id!,
    };
  if (
    runRow.status !== "ready_for_review" &&
    runRow.status !== "ready_to_publish"
  )
    return { status: "stale", runId, reason: `run_status_${runRow.status}` };

  const winner = await pool.query<{
    subject_id: string;
    fingerprint: string | null;
    candidate_id: string;
  }>(
    `SELECT rc.subject_id, rc.fingerprint, c.id AS candidate_id
     FROM daily_pick_run_candidate rc
     JOIN restaurant_candidate c ON c.subject_id = rc.subject_id AND c.area_id=$2
     WHERE rc.run_id=$1 AND rc.decision='picked'`,
    [runId, runRow.area_id],
  );
  const winnerRow = winner.rows[0];
  if (!winnerRow)
    return { status: "stale", runId, reason: "no_winner_recorded" };

  const copy = await pool.query<{
    id: string;
    review_status: string;
    en_sentences: unknown[];
    zh_sentences: unknown[];
  }>(
    `SELECT id, review_status, en_sentences, zh_sentences FROM restaurant_copy WHERE run_id=$1 AND candidate_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [runId, winnerRow.candidate_id],
  );
  const copyRow = copy.rows[0];
  if (!copyRow || copyRow.review_status !== "approved")
    return { status: "copy_not_approved", runId };

  const area = await pool.query<{
    id: string;
    city_slug: string;
    layer_slug: string;
    timezone: string;
    config: Record<string, unknown>;
  }>(
    `SELECT id, city_slug, layer_slug, timezone, config FROM restaurant_discovery_area WHERE id=$1`,
    [runRow.area_id],
  );
  const areaRow = area.rows[0];
  if (!areaRow) throw new Error(`Unknown area: ${runRow.area_id}`);
  const restaurantArea: RestaurantArea = {
    id: areaRow.id,
    citySlug: areaRow.city_slug,
    layerSlug: areaRow.layer_slug,
    timezone: areaRow.timezone,
    configVersion: 1,
    config: areaRow.config,
    enabled: true,
  };
  const config = areaRuleConfig(restaurantArea);

  // Fetch expensive, fresh finalist data OUTSIDE any lock.
  const freshCandidate = await loadCandidate(pool, winnerRow.candidate_id);
  if (!freshCandidate)
    return { status: "stale", runId, reason: "candidate_removed" };
  const freshFingerprint = candidateFingerprint(freshCandidate);
  if (winnerRow.fingerprint && winnerRow.fingerprint !== freshFingerprint)
    return { status: "stale", runId, reason: "evidence_or_review_changed" };
  const freshQuality = freshCandidate.provider_place_id
    ? await adapters.qualification.fetchQuality({
        providerPlaceId: freshCandidate.provider_place_id,
        dates: [addDays(runRow.run_date, -1), runRow.run_date],
      })
    : {
        rating: null,
        ratingCount: null,
        businessStatus: null,
        hoursByDate: new Map(),
        retrievedAt: now,
      };
  const freshCommitted = await loadCommittedFeatures(
    pool,
    runRow.area_id,
    options.expectedPickId ?? null,
  );
  const freshInput = toCandidateInput(
    freshCandidate,
    freshQuality,
    restaurantArea.timezone,
  );
  const freshQualification = qualifyRestaurantCandidate(
    freshInput,
    runRow.run_date,
    now,
    freshCommitted,
    config,
  );
  if (!freshQualification.qualified)
    return {
      status: "stale",
      runId,
      reason: freshQualification.primaryCode ?? "no_longer_qualified",
    };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `restaurant_area:${restaurantArea.id}`,
    ]);
    const cityRow = await client.query<{ id: string }>(
      "SELECT id FROM city WHERE slug = $1",
      [restaurantArea.citySlug],
    );
    const cityId = cityRow.rows[0]?.id;
    if (!cityId) throw new Error(`Unknown city: ${restaurantArea.citySlug}`);
    await lockDailyPickSlot(client, cityId, runRow.run_date);

    const lockedRun = await client.query<{
      status: string;
      final_pick_id: string | null;
    }>(
      `SELECT status, final_pick_id FROM daily_pick_run WHERE id=$1 FOR UPDATE`,
      [runId],
    );
    if (lockedRun.rows[0]?.status === "published") {
      await client.query("COMMIT");
      return {
        status: "unchanged",
        runId,
        pickId: lockedRun.rows[0].final_pick_id!,
      };
    }
    if (
      lockedRun.rows[0]?.status !== "ready_for_review" &&
      lockedRun.rows[0]?.status !== "ready_to_publish"
    ) {
      await client.query("ROLLBACK");
      return {
        status: "stale",
        runId,
        reason: `run_status_${lockedRun.rows[0]?.status ?? "missing"}`,
      };
    }

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM daily_pick WHERE city_id=$1 AND pick_date=$2::date AND status='published' FOR UPDATE`,
      [cityId, runRow.run_date],
    );
    const existingId = existing.rows[0]?.id ?? null;
    if (existingId && existingId !== options.expectedPickId) {
      await client.query("ROLLBACK");
      return { status: "revision_conflict", runId, currentPickId: existingId };
    }
    if (existingId)
      await client.query(
        `UPDATE daily_pick SET status='withdrawn', withdrawn_at=now(), withdrawn_by=$2, withdrawal_reason=$3, updated_at=now() WHERE id=$1`,
        [
          existingId,
          actorId,
          `Replaced by a new version 2 run (${runId}), confirmed by the caller.`,
        ],
      );

    const validFrom = zonedMidnight(runRow.run_date, restaurantArea.timezone);
    const enText = (copyRow.en_sentences as { text: string }[])
      .map((s) => s.text)
      .join(" ");
    const zhText = (copyRow.zh_sentences as { text: string }[])
      .map((s) => s.text)
      .join(" ");
    const pickInsert = await client.query<{ id: string }>(
      `INSERT INTO daily_pick(city_id, pick_date, place_id, subject_id, food_type, food_type_version, run_id, copy_id, status, selection_kind, selection_version, description, description_chinese, reasons, reason_text, reason_text_chinese, evidence, replaces_id, created_by)
       VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,'published','automatic',2,$9,$10,'[]'::jsonb,$9,$10,$11::jsonb,$12,$13)
       RETURNING id`,
      [
        cityId,
        runRow.run_date,
        freshCandidate.catalog_place_id,
        winnerRow.subject_id,
        freshCandidate.food_type,
        freshCandidate.food_type_version,
        runId,
        copyRow.id,
        enText,
        zhText,
        JSON.stringify({ reportRunId: runId }),
        existingId,
        actorId,
      ],
    );
    const pickId = pickInsert.rows[0].id;

    // A catalog-linked subject is already surfaced by Discover's rule-derived
    // catalog query; adding a layer_item would duplicate it on the map/list.
    if (!freshCandidate.catalog_place_id) {
      const layerRow = await client.query<{ id: string }>(
        "SELECT id FROM layer WHERE slug = $1",
        [restaurantArea.layerSlug],
      );
      const layerId = layerRow.rows[0]?.id;
      if (!layerId)
        throw new Error(
          `Discover layer not found: ${restaurantArea.layerSlug}`,
        );
      const existingItem = await client.query<{ id: string }>(
        `SELECT id FROM layer_item WHERE layer_id=$1 AND subject_id=$2`,
        [layerId, winnerRow.subject_id],
      );
      let layerItemId = existingItem.rows[0]?.id;
      if (layerItemId)
        // Only ever move visibility earlier, never later: an existing valid
        // (possibly independently-curated) item must never be hidden by a
        // later reservation's valid_from.
        await client.query(
          `UPDATE layer_item SET valid_from = LEAST(COALESCE(valid_from, $2), $2) WHERE id=$1`,
          [layerItemId, validFrom],
        );
      else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO layer_item(layer_id, subject_id, note, valid_from) VALUES($1,$2,'',$3) RETURNING id`,
          [layerId, winnerRow.subject_id, validFrom],
        );
        layerItemId = inserted.rows[0].id;
      }
      await client.query(
        `INSERT INTO daily_pick_layer_membership(pick_id, layer_id, layer_item_id) VALUES($1,$2,$3)`,
        [pickId, layerId, layerItemId],
      );
    }

    if (actorId)
      await client.query(
        `INSERT INTO moderation_action(entity_type,entity_id,action,reason,actor_id) VALUES('places',$1,'approved',$2,$3)`,
        [
          winnerRow.subject_id,
          `Published as the ${runRow.run_date} restaurant recommendation for ${restaurantArea.citySlug}.`,
          actorId,
        ],
      );
    await client.query(
      `INSERT INTO analytics_event(user_id,name,properties) VALUES($1,'restaurant_pick_published',$2::jsonb)`,
      [
        actorId,
        JSON.stringify({
          subjectId: winnerRow.subject_id,
          citySlug: restaurantArea.citySlug,
          date: runRow.run_date,
        }),
      ],
    );
    await client.query(
      `UPDATE daily_pick_run SET status='published', final_pick_id=$2, copy_status='approved', updated_at=now() WHERE id=$1`,
      [runId, pickId],
    );
    await client.query("COMMIT");
    return {
      status: existingId ? "replaced" : "created",
      runId,
      pickId,
      subjectId: winnerRow.subject_id,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Withdraw a published version 2 pick: remove only this pick's own
 * daily_pick_layer_membership row, then delete the shared layer_item only if
 * (a) no other pick's membership still references it and (b) it was never
 * independently curated (`added_by IS NULL`, i.e. created solely by the
 * publish step above) — preserving both a moderator's own curation and any
 * other historical pick that still needs the same item visible.
 */
export async function withdrawRestaurantPick(
  pickId: string,
  reason: string,
  actorId: string | null,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const membership = await client.query<{ layer_item_id: string }>(
      `DELETE FROM daily_pick_layer_membership WHERE pick_id=$1 RETURNING layer_item_id`,
      [pickId],
    );
    await client.query(
      `UPDATE daily_pick SET status='withdrawn', withdrawn_at=now(), withdrawn_by=$2, withdrawal_reason=$3, updated_at=now() WHERE id=$1 AND status='published'`,
      [pickId, actorId, reason],
    );
    const layerItemId = membership.rows[0]?.layer_item_id;
    if (layerItemId)
      await client.query(
        `DELETE FROM layer_item WHERE id=$1 AND added_by IS NULL
           AND NOT EXISTS (SELECT 1 FROM daily_pick_layer_membership WHERE layer_item_id=$1)`,
        [layerItemId],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
