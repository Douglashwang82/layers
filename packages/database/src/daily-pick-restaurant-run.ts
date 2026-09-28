import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "./index";
import { lockDailyPickSlot } from "./daily-pick";
import {
  addDays,
  buildRestaurantReport,
  foodTypeFromProviderType,
  templateRestaurantCopy,
  qualifyRestaurantCandidate,
  rankCandidates,
  restaurantRuleConfigSchema,
  restaurantRuleDefaults,
  isCalendarDate,
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
 * - `prepareRestaurantPickRun` claims a leased run, discovers/upserts
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
  const overrides = restaurantRuleConfigSchema.partial().parse(area.config);
  return restaurantRuleConfigSchema.parse({
    ...restaurantRuleDefaults,
    ...overrides,
  });
}
/** Bounded discovery/qualification request budgets, from `area.config`. */
const areaBudgetSchema = z.object({
  queryGroups: z.array(z.string().min(1)).default([]),
  discoveryBudgetPerRun: z.number().int().min(0).default(0),
  qualificationBudgetPerRun: z.number().int().min(0).default(200),
  /**
   * Owner-approved trust in discovery: a found restaurant whose provider type
   * maps to a food type is approved with the area's city confirmed, instead
   * of waiting in `discovered` for a moderator.
   */
  autoApproveDiscovered: z.boolean().default(false),
});
function areaBudgets(area: RestaurantArea) {
  return areaBudgetSchema.parse(area.config);
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
    if (row && ["ready_for_review", "ready_to_publish"].includes(row.status))
      throw new RunBusy(row.id);
    const isTerminal = (status: string) =>
      (terminalRunStatuses as readonly string[]).includes(status);
    if (!row || isTerminal(row.status)) {
      const inserted = await client.query<{ id: string; attempt: number }>(
        `INSERT INTO daily_pick_run(area_id, run_date, attempt, status, config_version, rules_config, lease_owner, lease_expires_at)
         VALUES($1,$2::date,$3,'discovering',$4,$7::jsonb,$5,$6)
         RETURNING id, attempt`,
        [
          area.id,
          date,
          (row?.attempt ?? 0) + 1,
          area.configVersion,
          leaseOwner,
          new Date(now.getTime() + leaseDurationMs),
          JSON.stringify(areaRuleConfig(area)),
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
      `UPDATE daily_pick_run SET status='discovering', lease_owner=$2, lease_expires_at=$3, config_version=$4, rules_config=$5::jsonb,error_code=NULL, updated_at=now() WHERE id=$1`,
      [
        row.id,
        leaseOwner,
        new Date(now.getTime() + leaseDurationMs),
        area.configVersion,
        JSON.stringify(areaRuleConfig(area)),
      ],
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
     WHERE id=$1 AND lease_owner=$2 AND lease_expires_at>$5 AND status <> ALL($4::text[]) RETURNING id`,
    [
      runId,
      leaseOwner,
      new Date(now.getTime() + leaseDurationMs),
      terminalRunStatuses,
      now,
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
  client: PoolClient | typeof pool = pool,
) {
  const result = await client.query(
    `UPDATE daily_pick_run SET status=$2, error_code=$3,
       evaluated_count=COALESCE($4, evaluated_count),
       eligible_count=COALESCE($5, eligible_count),
       excluded_count=COALESCE($6, excluded_count),
       lease_expires_at=NULL, lease_owner=NULL, updated_at=now()
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
  if (!result.rowCount) throw new RunLeaseLost(runId);
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
  const offset =
    Math.floor(now.getTime() / 86400000) % budgets.queryGroups.length;
  const groups = [
    ...budgets.queryGroups.slice(offset),
    ...budgets.queryGroups.slice(0, offset),
  ];
  for (const queryGroup of groups) {
    if (requestCount >= budgets.discoveryBudgetPerRun) break;
    requestCount += 1;
    try {
      const outcome = await discovery.discover({
        areaId: area.id,
        queryGroup,
        pageToken: null,
      });
      for (const found of outcome.found) {
        const upserted = await upsertDiscoveredCandidate(
          area.id,
          found,
          budgets.autoApproveDiscovered,
        );
        if (upserted) discoveredCount += 1;
      }
    } catch (error) {
      errors.push({
        queryGroup,
        message:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "discovery_failed",
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
        : errors.length === requestCount
          ? "failed"
          : "partial",
      requestCount,
      discoveredCount,
      JSON.stringify(errors),
    ],
  );
  if (errors.length)
    throw new Error("Discovery partially failed; retry before selection.");
}

async function cityName(citySlug: string) {
  const result = await pool.query<{ name: string }>(
    "SELECT name FROM city WHERE slug=$1",
    [citySlug],
  );
  return result.rows[0]?.name ?? citySlug;
}
async function upsertDiscoveredCandidate(
  areaId: string,
  found: DiscoveredRestaurant,
  autoApprove = false,
): Promise<boolean> {
  const existingRef = await pool.query<{ subject_id: string }>(
    `SELECT subject_id FROM place_provider_reference WHERE provider='google' AND provider_place_id=$1`,
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
          `SELECT subject_id FROM place_provider_reference WHERE provider='google' AND provider_place_id=$1`,
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
  if (found.name)
    await pool.query(
      `UPDATE place_provider_reference SET display_name=$2, display_name_updated_at=now(), updated_at=now()
       WHERE provider='google' AND provider_place_id=$1 AND display_name IS DISTINCT FROM $2`,
      [found.providerPlaceId, found.name],
    );
  const foodType = autoApprove
    ? foodTypeFromProviderType(found.primaryType)
    : null;
  if (!foodType) {
    const candidate = await pool.query(
      `INSERT INTO restaurant_candidate(area_id, subject_id, state) VALUES($1,$2,'discovered')
       ON CONFLICT (area_id, subject_id) DO NOTHING RETURNING id`,
      [areaId, subjectId],
    );
    return Boolean(candidate.rowCount);
  }
  // Only untouched candidates are auto-approved: anything a moderator has
  // reviewed, approved or excluded keeps its state and food type.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE place_subject SET city_id=(SELECT c.id FROM city c JOIN restaurant_discovery_area a ON a.city_slug=c.slug WHERE a.id=$2),
         city_review_status='approved', city_reviewed_at=now(), revision=revision+1, updated_at=now()
       WHERE id=$1 AND city_review_status='unreviewed'`,
      [subjectId, areaId],
    );
    const candidate = await client.query(
      `INSERT INTO restaurant_candidate(area_id, subject_id, state, food_type, food_type_version, food_type_source, reviewed_at)
       VALUES($1,$2,'approved',$3,1,'provider',now())
       ON CONFLICT (area_id, subject_id) DO UPDATE SET state='approved', food_type=EXCLUDED.food_type,
         food_type_version=1, food_type_source='provider', reviewed_at=now(), updated_at=now()
       WHERE restaurant_candidate.state='discovered'
       RETURNING id`,
      [areaId, subjectId, foodType],
    );
    await client.query("COMMIT");
    return Boolean(candidate.rowCount);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

type CandidateRow = {
  candidate_state: string;
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
  SELECT c.id AS candidate_id, c.state AS candidate_state, c.subject_id, c.food_type, c.food_type_version, c.updated_at AS candidate_updated_at,
     s.status = 'active' AS subject_active, s.city_review_status, s.updated_at AS subject_updated_at,
     (s.city_id IS NOT NULL AND EXISTS (SELECT 1 FROM restaurant_discovery_area a WHERE a.id=c.area_id AND a.city_slug=(SELECT slug FROM city WHERE id=s.city_id))) AS in_area,
     s.catalog_place_id, p.status AS catalog_status, p.is_demo AS catalog_is_demo,
     (SELECT r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) AS provider_place_id,
     COALESCE(p.name, (SELECT r.display_name FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1), 'Candidate ' || c.id::text) AS label,
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
     WHERE a.id = $1 AND (d.status='published' OR (d.status='withdrawn' AND d.withdrawn_at >= d.pick_date::timestamp AT TIME ZONE c.timezone)) AND d.subject_id IS NOT NULL
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
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.candidate_state,
        row.candidate_updated_at,
        row.provider_place_id,
        row.subject_active,
        row.city_review_status,
        row.in_area,
        row.catalog_place_id,
        row.catalog_status,
        row.catalog_is_demo,
        row.food_type,
        row.food_type_version,
        row.evidence.map((e) => [e.id, e.approvedAt, e.label, e.sourceUrl]),
      ]),
    )
    .digest("hex");
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
      active: row.subject_active && row.candidate_state === "approved",
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
 * Expired preparation work can be reclaimed; review drafts remain intact.
 * The scheduler in restaurant-jobs.ts leaves previously attempted dates alone.
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
  if (!isCalendarDate(date)) throw new Error("Invalid restaurant run date.");
  if (!area.enabled)
    throw new Error(
      `Refusing to run a restaurant pick for a disabled area (${area.citySlug}). Enable it explicitly once Phase 0 is approved.`,
    );
  const config = areaRuleConfig(area);
  const leaseOwner = options.leaseOwner ?? `prepare:${crypto.randomUUID()}`;
  const { runId } = await claimRestaurantRun(area, date, leaseOwner, now);

  try {
    await discoverCandidates(area, runId, adapters.discovery, now);
    await renewLease(runId, leaseOwner, options.now ?? new Date());

    const poolCandidates = await loadApprovedCandidates(pool, area.id);
    const committed = await loadCommittedFeatures(pool, area.id, null);
    const budgets = areaBudgets(area);
    const offset = poolCandidates.length
      ? Math.floor(new Date(date).getTime() / 86400000) % poolCandidates.length
      : 0;
    const candidates = [
      ...poolCandidates.slice(offset),
      ...poolCandidates.slice(0, offset),
    ].slice(0, budgets.qualificationBudgetPerRun);
    if (
      committed.some(
        (f) =>
          f.foodType === null &&
          Math.abs(new Date(f.date).getTime() - new Date(date).getTime()) <=
            config.foodRotationDays * 86400000,
      )
    ) {
      await setRunStatus(runId, leaseOwner, {
        status: "failed",
        errorCode: "history_food_type_unreviewed",
      });
      return {
        status: "failed",
        runId,
        errorCode: "history_food_type_unreviewed",
      };
    }

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
      await renewLease(runId, leaseOwner, options.now ?? new Date());
      inputs.push(toCandidateInput(row, quality, area.timezone));
    }
    // Every qualification call failed (not merely "quality unknown" for a
    // subset): this is a transport/auth/quota outage, not an honest empty
    // pool, and must not silently masquerade as "no eligible candidates".
    if (qualificationCalls > 0 && qualificationFailures > 0) {
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
    await renewLease(runId, leaseOwner, options.now ?? new Date());

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
      if (
        !config.requireEvidence &&
        row.evidence.length < 2 &&
        input.foodType
      ) {
        copyRecords.set(input.subjectId, {
          output: templateRestaurantCopy({
            foodType: input.foodType,
            citySlug: area.citySlug,
            cityName: await cityName(area.citySlug),
          }),
          approvedFactIds: new Set(),
        });
        copyOutcomes.set(input.subjectId, "grounded");
        break;
      }
      try {
        const output = await adapters.copy.generate({
          candidateLabel: row.catalog_place_id ? row.label : "This restaurant",
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

    const reportClient = await pool.connect();
    try {
      await reportClient.query("BEGIN");
      const owned = await reportClient.query(
        `SELECT id FROM daily_pick_run WHERE id=$1 AND lease_owner=$2 AND lease_expires_at>$3 FOR UPDATE`,
        [runId, leaseOwner, options.now ?? new Date()],
      );
      if (!owned.rowCount) throw new RunLeaseLost(runId);
      await reportClient.query(
        `DELETE FROM daily_pick_run_candidate WHERE run_id = $1`,
        [runId],
      );
      for (const row of outcome.report) {
        const candidateRow = candidateById.get(row.subjectId);
        const fingerprint =
          row.decision === "picked" && candidateRow
            ? candidateFingerprint(candidateRow)
            : null;
        await reportClient.query(
          `INSERT INTO daily_pick_run_candidate(run_id, subject_id, base_rank, eligible_rank, report_position, decision, score, primary_reason_code, reason_codes, fingerprint)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
          [
            runId,
            row.subjectId,
            row.baseRank,
            row.eligibleRank,
            row.reportPosition,
            row.decision,
            // Derived from Google rating data, which the Phase 0 decision
            // keeps transient: rank and reason codes persist, the score does not.
            null,
            row.primaryReasonCode,
            JSON.stringify(row.allReasonCodes),
            fingerprint,
          ],
        );
      }

      if (outcome.status === "empty") {
        await setRunStatus(
          runId,
          leaseOwner,
          {
            status: "empty",
            errorCode: outcome.reason,
            evaluatedCount: outcome.evaluatedCount,
            eligibleCount: outcome.evaluatedCount - outcome.excludedCount,
            excludedCount: outcome.excludedCount,
          },
          reportClient,
        );
        await reportClient.query("COMMIT");
        return { status: "empty", runId, reason: outcome.reason };
      }

      const winnerRow = candidateById.get(outcome.winnerSubjectId)!;
      const copyRecord = copyRecords.get(outcome.winnerSubjectId)!;
      const copyInsert = await reportClient.query<{ id: string }>(
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
      await setRunStatus(
        runId,
        leaseOwner,
        {
          status: "ready_for_review",
          evaluatedCount: outcome.evaluatedCount,
          eligibleCount: outcome.evaluatedCount - outcome.excludedCount,
          excludedCount: outcome.excludedCount,
        },
        reportClient,
      );
      await reportClient.query("COMMIT");
      return {
        status: "ready_for_review",
        runId,
        winnerSubjectId: outcome.winnerSubjectId,
        copyId: copyInsert.rows[0].id,
      };
    } catch (error) {
      await reportClient.query("ROLLBACK");
      throw error;
    } finally {
      reportClient.release();
    }
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

/** A moderator review and its audit trail commit together. */
async function reviewRestaurantCopy(
  copyId: string,
  actorId: string,
  approved: boolean,
  reason: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const copy = await client.query<{ run_id: string }>(
      "SELECT run_id FROM restaurant_copy WHERE id=$1",
      [copyId],
    );
    if (!copy.rows[0]) throw new Error("Unknown copy.");
    const run = await client.query(
      "SELECT id FROM daily_pick_run WHERE id=$1 AND status='ready_for_review' FOR UPDATE",
      [copy.rows[0].run_id],
    );
    if (!run.rowCount)
      throw new Error("This run is no longer awaiting review.");
    const updated = await client.query(
      `UPDATE restaurant_copy SET review_status=$3,reviewed_by=$2,reviewed_at=now(),updated_at=now() WHERE id=$1 AND review_status='pending' RETURNING id`,
      [copyId, actorId, approved ? "approved" : "rejected"],
    );
    if (!updated.rowCount) throw new Error("Copy is not pending review.");
    await client.query(
      `UPDATE daily_pick_run SET copy_status=$2,status=$3,reviewed_by=$4,updated_at=now() WHERE id=$1`,
      [
        copy.rows[0].run_id,
        approved ? "approved" : "rejected",
        approved ? "ready_for_review" : "canceled",
        actorId,
      ],
    );
    await client.query(
      `INSERT INTO moderation_action(entity_type,entity_id,action,reason,actor_id) VALUES('places',$1,$2,$3,$4)`,
      [copyId, approved ? "approved" : "rejected", reason, actorId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function approveRestaurantCopy(copyId: string, actorId: string) {
  await reviewRestaurantCopy(
    copyId,
    actorId,
    true,
    "Approved restaurant recommendation copy.",
  );
}
export async function rejectRestaurantCopy(
  copyId: string,
  actorId: string,
  reason: string,
) {
  await reviewRestaurantCopy(copyId, actorId, false, reason);
}

export type PublishOutcome =
  | {
      status: "created" | "replaced";
      runId: string;
      pickId: string;
      subjectId: string;
    }
  | { status: "unchanged"; runId: string; pickId: string }
  | { status: "revision_conflict"; runId: string; currentPickId: string | null }
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
    config_version: number;
    rules_config: RestaurantRuleConfig;
  }>(
    `SELECT id, area_id, run_date::text AS run_date, status, final_pick_id, config_version, rules_config FROM daily_pick_run WHERE id=$1`,
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
    config_version: number;
    enabled: boolean;
  }>(
    `SELECT id, city_slug, layer_slug, timezone, config, config_version, enabled FROM restaurant_discovery_area WHERE id=$1`,
    [runRow.area_id],
  );
  const areaRow = area.rows[0];
  if (!areaRow) throw new Error(`Unknown area: ${runRow.area_id}`);
  const restaurantArea: RestaurantArea = {
    id: areaRow.id,
    citySlug: areaRow.city_slug,
    layerSlug: areaRow.layer_slug,
    timezone: areaRow.timezone,
    configVersion: areaRow.config_version,
    config: areaRow.config,
    enabled: areaRow.enabled,
  };
  const config = areaRuleConfig(restaurantArea);
  if (
    !restaurantArea.enabled ||
    runRow.config_version !== restaurantArea.configVersion ||
    JSON.stringify(config) !==
      JSON.stringify(restaurantRuleConfigSchema.parse(runRow.rules_config))
  )
    return { status: "stale", runId, reason: "area_configuration_changed" };

  // Fetch expensive, fresh finalist data OUTSIDE any lock.
  const freshCandidate = await loadCandidate(pool, winnerRow.candidate_id);
  if (!freshCandidate)
    return { status: "stale", runId, reason: "candidate_removed" };
  const freshFingerprint = candidateFingerprint(freshCandidate);
  if (winnerRow.fingerprint !== freshFingerprint)
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
    return { status: "stale", runId, reason: freshQualification.codes[0] };

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
    if (existingId !== (options.expectedPickId ?? null)) {
      await client.query("ROLLBACK");
      return { status: "revision_conflict", runId, currentPickId: existingId };
    }
    // Provider calls finish before locks. Lock every mutable approval row and
    // evaluate again against history serialized by the area lock.
    await client.query(
      "SELECT id FROM restaurant_discovery_area WHERE id=$1 FOR SHARE",
      [restaurantArea.id],
    );
    await client.query(
      "SELECT id FROM restaurant_candidate WHERE id=$1 FOR UPDATE",
      [winnerRow.candidate_id],
    );
    await client.query("SELECT id FROM place_subject WHERE id=$1 FOR SHARE", [
      winnerRow.subject_id,
    ]);
    await client.query(
      "SELECT id FROM place_provider_reference WHERE subject_id=$1 FOR SHARE",
      [winnerRow.subject_id],
    );
    await client.query(
      "SELECT id FROM restaurant_evidence WHERE candidate_id=$1 FOR SHARE",
      [winnerRow.candidate_id],
    );
    if (freshCandidate.catalog_place_id)
      await client.query("SELECT id FROM place WHERE id=$1 FOR SHARE", [
        freshCandidate.catalog_place_id,
      ]);
    const lockedCandidate = await loadCandidate(client, winnerRow.candidate_id);
    const lockedArea = await loadRestaurantArea(
      client,
      restaurantArea.citySlug,
    );
    const lockedCopy = await client.query<{ review_status: string }>(
      "SELECT review_status FROM restaurant_copy WHERE id=$1 FOR UPDATE",
      [copyRow.id],
    );
    if (
      !lockedCandidate ||
      candidateFingerprint(lockedCandidate) !== freshFingerprint ||
      !lockedArea?.enabled ||
      lockedArea.configVersion !== runRow.config_version ||
      JSON.stringify(areaRuleConfig(lockedArea)) !== JSON.stringify(config) ||
      lockedCopy.rows[0]?.review_status !== "approved"
    ) {
      await client.query("ROLLBACK");
      return { status: "stale", runId, reason: "evidence_or_review_changed" };
    }
    const finalQualification = qualifyRestaurantCandidate(
      toCandidateInput(lockedCandidate, freshQuality, lockedArea.timezone),
      runRow.run_date,
      options.now ?? new Date(),
      await loadCommittedFeatures(client, runRow.area_id, existingId),
      config,
    );
    if (!finalQualification.qualified) {
      await client.query("ROLLBACK");
      return { status: "stale", runId, reason: finalQualification.codes[0] };
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
       VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,'published','automatic',2,$9,$10,'[]'::jsonb,$14,$15,$11::jsonb,$12,$13)
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
        "Selected after checking Google rating quality, service hours for this date, recent restaurant and food-type history, and approved facts supporting the recommendation.",
        "經查核 Google 評分品質、指定日期營業時間、近期餐廳與餐點類型推薦紀錄，以及支持推薦內容的已核准事實後入選。",
      ],
    );
    const pickId = pickInsert.rows[0].id;

    // A catalog-linked subject is already surfaced by Discover's rule-derived
    // catalog query, and by the version 1 daily-pick card/history queries
    // (now subject-aware, see apps/web/src/features/daily-pick/repository.ts)
    // directly from daily_pick.place_id — adding a layer_item would duplicate
    // it on the map/list. An external (non-catalog) winner has no such
    // rule-derived path, so it needs an explicit layer_item in BOTH its
    // area's Discover layer and the city's own separate Daily Pick layer
    // (the latter is what the Daily Pick layer's external-reference list
    // falls back to, since there is no server-stored coordinate to place a
    // map pin at).
    if (!freshCandidate.catalog_place_id) {
      const layers = await client.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM layer WHERE slug = ANY($1::text[]) AND city_id=$2 AND audience='public' AND review_status='approved' AND lifecycle='active' AND owner_kind='system' FOR SHARE`,
        [
          [restaurantArea.layerSlug, `daily-pick-${restaurantArea.citySlug}`],
          cityId,
        ],
      );
      if (!layers.rows.some((l) => l.slug === restaurantArea.layerSlug))
        throw new Error(
          `Discover layer not found: ${restaurantArea.layerSlug}`,
        );
      for (const layer of layers.rows) {
        const existingItem = await client.query<{ id: string }>(
          `SELECT id FROM layer_item WHERE layer_id=$1 AND subject_id=$2`,
          [layer.id, winnerRow.subject_id],
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
            `INSERT INTO layer_item(layer_id, subject_id, note, valid_from,restaurant_managed) VALUES($1,$2,'',$3,true) RETURNING id`,
            [layer.id, winnerRow.subject_id, validFrom],
          );
          layerItemId = inserted.rows[0].id;
        }
        await client.query(
          `INSERT INTO daily_pick_layer_membership(pick_id, layer_id, layer_item_id) VALUES($1,$2,$3)
           ON CONFLICT (pick_id, layer_id) DO NOTHING`,
          [pickId, layer.id, layerItemId],
        );
      }
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
 * daily_pick_layer_membership row(s) — there can be more than one, since an
 * external winner contributes to both its area's Discover layer and the
 * city's separate Daily Pick layer — then delete each shared layer_item only
 * if (a) no other pick's membership still references it and (b) it was
 * never independently curated (`added_by IS NULL`, i.e. created solely by
 * the publish step above) — preserving both a moderator's own curation and
 * any other historical pick that still needs the same item visible.
 */
export async function withdrawRestaurantPick(
  pickId: string,
  reason: string,
  actorId: string | null,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pick = await client.query<{
      area_id: string;
      city_id: string;
      pick_date: string;
    }>(
      `SELECT r.area_id,d.city_id,d.pick_date::text FROM daily_pick d JOIN daily_pick_run r ON r.id=d.run_id WHERE d.id=$1 AND d.selection_version=2`,
      [pickId],
    );
    if (!pick.rows[0]) throw new Error("Unknown restaurant pick.");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `restaurant_area:${pick.rows[0].area_id}`,
    ]);
    await lockDailyPickSlot(
      client,
      pick.rows[0].city_id,
      pick.rows[0].pick_date,
    );
    if (actorId)
      await client.query(
        `INSERT INTO moderation_action(entity_type,entity_id,action,reason,actor_id) VALUES('places',$1,'hidden',$2,$3)`,
        [pickId, reason, actorId],
      );
    const membership = await client.query<{ layer_item_id: string }>(
      `DELETE FROM daily_pick_layer_membership WHERE pick_id=$1 RETURNING layer_item_id`,
      [pickId],
    );
    await client.query(
      `UPDATE daily_pick SET status='withdrawn', withdrawn_at=now(), withdrawn_by=$2, withdrawal_reason=$3, updated_at=now() WHERE id=$1 AND status='published'`,
      [pickId, actorId, reason],
    );
    for (const { layer_item_id: layerItemId } of membership.rows)
      await client.query(
        `DELETE FROM layer_item WHERE id=$1 AND added_by IS NULL AND restaurant_managed
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
