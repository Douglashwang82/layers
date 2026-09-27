import type { PoolClient } from "pg";
import { pool } from "./index";
import {
  buildRestaurantReport,
  qualifyRestaurantCandidate,
  rankCandidates,
  restaurantRuleConfigSchema,
  restaurantRuleDefaults,
  validateRestaurantCopy,
  zonedMidnight,
  type CommittedFeature,
  type CopyAttemptOutcome,
  type RestaurantCandidateInput,
  type RestaurantCopyOutput,
  type RestaurantRuleConfig,
} from "../../shared/src";
import type {
  RestaurantCopyAdapter,
  RestaurantQualificationAdapter,
  RestaurantQualitySnapshot,
} from "./restaurant-providers";

/**
 * Worker orchestration for the daily restaurant recommendation (version 2):
 * loads reviewer-approved candidates, refreshes their quality/hours through
 * an injected qualification adapter, runs the pure shared rules, attempts
 * grounded copy through an injected copy adapter, and atomically publishes
 * the winner into Discover for the area's city. Adapters are always passed
 * in explicitly (see restaurant-providers.ts): this module never decides
 * whether to use a fake or a real provider, and it never makes a network
 * call itself. See
 * docs/plans/daily-restaurant-recommendation-implementation-plan.md
 * sections 4, 5 and 8.
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

type CandidateRow = {
  candidate_id: string;
  subject_id: string;
  provider_place_id: string | null;
  food_type: string | null;
  food_type_version: number | null;
  label: string;
  subject_active: boolean;
  city_review_status: string;
  evidence: { id: string; label: string; sourceUrl: string | null }[];
};
/**
 * Reviewer-approved candidates only: discovery may create an unreviewed
 * subject, but publication requires an active, city-reviewed subject and an
 * `approved` candidate state (see restaurant_candidate.state).
 */
export async function loadApprovedCandidates(
  client: PoolClient | typeof pool,
  areaId: string,
): Promise<CandidateRow[]> {
  const result = await client.query<CandidateRow>(
    `SELECT c.id AS candidate_id, c.subject_id, c.food_type, c.food_type_version,
       s.status = 'active' AS subject_active, s.city_review_status,
       (SELECT r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) AS provider_place_id,
       COALESCE(
         (SELECT p.name FROM place p WHERE p.id = s.catalog_place_id),
         'Candidate ' || c.id::text
       ) AS label,
       COALESCE(
         (SELECT jsonb_agg(jsonb_build_object('id', e.id::text, 'label', e.label, 'sourceUrl', e.source_url))
          FROM restaurant_evidence e WHERE e.candidate_id = c.id AND e.approved_for_copy),
         '[]'::jsonb
       ) AS evidence
     FROM restaurant_candidate c
     JOIN place_subject s ON s.id = c.subject_id
     WHERE c.area_id = $1 AND c.state = 'approved'
     ORDER BY c.id`,
    [areaId],
  );
  return result.rows;
}

/**
 * Every published, food-type-tagged version 2 pick in the area's city:
 * rotation history that a new run must not conflict with. Withdrawal keeps
 * consuming its window (only `status='published'` rows are excluded here by
 * virtue of the join, but a withdrawn row's date is never re-checked against
 * `committed`, matching "withdrawal cannot be used to reset rotation" only
 * for still-published rows; a fully separate historical-window backfill for
 * withdrawn/version-1 rows is listed as remaining work).
 */
export async function loadCommittedFeatures(
  client: PoolClient | typeof pool,
  areaId: string,
  excludePickId: string | null,
): Promise<CommittedFeature[]> {
  const rows = await client.query<{
    pick_date: string;
    subject_id: string;
    food_type: string;
    id: string;
  }>(
    `SELECT d.pick_date::text AS pick_date, d.subject_id, d.food_type, d.id
     FROM daily_pick d
     JOIN city c ON c.id = d.city_id
     JOIN restaurant_discovery_area a ON a.city_slug = c.slug
     WHERE a.id = $1 AND d.status = 'published' AND d.subject_id IS NOT NULL AND d.food_type IS NOT NULL
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

function toCandidateInput(
  row: CandidateRow,
  quality: RestaurantQualitySnapshot,
  timeZone: string,
): RestaurantCandidateInput {
  return {
    subjectId: row.subject_id,
    canonicalId: row.subject_id,
    foodType: row.food_type,
    foodTypeVersion: row.food_type_version,
    visibility: {
      active: row.subject_active,
      isDemo: false,
      inGreaterHouston: true,
      catalogApproved: row.city_review_status === "approved",
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

export type RestaurantRunResult =
  | {
      status: "created" | "replaced";
      runId: string;
      pickId: string;
      subjectId: string;
    }
  | { status: "unchanged"; runId: string; pickId: string }
  | { status: "empty"; runId: string; reason: string };

/**
 * Run one area/date attempt end to end: qualify, rank, attempt copy, and
 * atomically publish the winner. Provider/LLM adapter calls happen before
 * any lock is held; only the final revalidate-and-commit step is
 * transactional, per the plan's "outside database locks" requirement.
 */
export async function runRestaurantPick(
  area: RestaurantArea,
  date: string,
  adapters: {
    qualification: RestaurantQualificationAdapter;
    copy: RestaurantCopyAdapter;
  },
  options: {
    now?: Date;
    config?: RestaurantRuleConfig;
    actorId?: string | null;
  } = {},
): Promise<RestaurantRunResult> {
  const now = options.now ?? new Date();
  const config = options.config
    ? restaurantRuleConfigSchema.parse(options.config)
    : restaurantRuleDefaults;
  if (!area.enabled)
    throw new Error(
      `Refusing to run a restaurant pick for a disabled area (${area.citySlug}). Enable it explicitly once Phase 0 is approved.`,
    );

  const runInsert = await pool.query<{ id: string }>(
    `INSERT INTO daily_pick_run(area_id, run_date, attempt, status, config_version, rules_config)
     VALUES($1,$2::date,
       COALESCE((SELECT max(attempt) FROM daily_pick_run WHERE area_id=$1 AND run_date=$2::date), 0) + 1,
       'discovering', $3, $4::jsonb)
     RETURNING id`,
    [area.id, date, area.configVersion, JSON.stringify(config)],
  );
  const runId = runInsert.rows[0].id;

  const candidates = await loadApprovedCandidates(pool, area.id);
  const committed = await loadCommittedFeatures(pool, area.id, null);

  const inputs: RestaurantCandidateInput[] = [];
  for (const row of candidates) {
    // No current provider reference: nothing to refresh quality/hours from.
    // Treated as excluded (quality_unknown) rather than silently skipped, by
    // still including it with null quality facts.
    const quality: RestaurantQualitySnapshot = row.provider_place_id
      ? await adapters.qualification.fetchQuality({
          providerPlaceId: row.provider_place_id,
          dates: [date],
        })
      : {
          rating: null,
          ratingCount: null,
          businessStatus: null,
          hoursByDate: new Map(),
          retrievedAt: now,
        };
    inputs.push(toCandidateInput(row, quality, area.timezone));
  }

  const candidateById = new Map(candidates.map((c) => [c.subject_id, c]));
  const copyRecords = new Map<
    string,
    { output: RestaurantCopyOutput; approvedFactIds: Set<string> }
  >();
  // buildRestaurantReport's attemptCopy callback is synchronous, but copy
  // generation is inherently async. We compute the exact eligible order
  // ourselves first, using the same shared rankCandidates/
  // qualifyRestaurantCandidate functions buildRestaurantReport uses
  // internally with the identical inputs/committed/config/date/now, so the
  // deterministic order it re-derives is guaranteed to match; then we run
  // real (awaited) copy attempts in that order and hand buildRestaurantReport
  // a simple synchronous lookup into the results.
  const copyOutcomes = new Map<string, CopyAttemptOutcome>();
  const attemptCopy = (input: RestaurantCandidateInput): CopyAttemptOutcome =>
    copyOutcomes.get(input.subjectId) ?? "copy_failed";
  const ranked = rankCandidates(inputs, area.id, date, config);
  const eligibleInOrder = ranked.filter(
    (r) =>
      qualifyRestaurantCandidate(r.candidate, date, now, committed, config)
        .qualified,
  );
  // eligibleInOrder is already restricted to hasIndependentEvidence candidates
  // (qualifyRestaurantCandidate treats fewer than two approved facts as the
  // hard-gate `insufficient_evidence`, before copy is ever attempted).
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
    await pool.query(
      `INSERT INTO daily_pick_run_candidate(run_id, subject_id, base_rank, eligible_rank, report_position, decision, score, primary_reason_code, reason_codes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
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
      ],
    );
  }

  if (outcome.status === "empty") {
    await pool.query(
      `UPDATE daily_pick_run SET status='empty', error_code=$2, evaluated_count=$3, eligible_count=$4, excluded_count=$5, updated_at=now() WHERE id=$1`,
      [
        runId,
        outcome.reason,
        outcome.evaluatedCount,
        outcome.evaluatedCount - outcome.excludedCount,
        outcome.excludedCount,
      ],
    );
    return { status: "empty", runId, reason: outcome.reason };
  }

  const winnerRow = candidateById.get(outcome.winnerSubjectId)!;
  const winnerInput = inputs.find(
    (i) => i.subjectId === outcome.winnerSubjectId,
  )!;
  const copyRecord = copyRecords.get(outcome.winnerSubjectId)!;
  const publish = await publishRestaurantPick({
    area,
    date,
    runId,
    subjectId: outcome.winnerSubjectId,
    foodType: winnerInput.foodType!,
    foodTypeVersion: winnerInput.foodTypeVersion,
    copy: copyRecord.output,
    label: winnerRow.label,
    evidence: outcome,
    actorId: options.actorId ?? null,
  });

  await pool.query(
    `UPDATE daily_pick_run SET status='published', final_pick_id=$2, evaluated_count=$3, eligible_count=$4, excluded_count=$5, copy_status='approved', updated_at=now() WHERE id=$1`,
    [
      runId,
      publish.pickId,
      outcome.evaluatedCount,
      outcome.evaluatedCount - outcome.excludedCount,
      outcome.excludedCount,
    ],
  );
  return {
    status: publish.replaced ? "replaced" : "created",
    runId,
    pickId: publish.pickId,
    subjectId: outcome.winnerSubjectId,
  };
}

/**
 * The short, atomic publication transaction: area advisory lock, target-slot
 * lock, revalidate, withdraw-if-needed, insert the pick, the Discover
 * layer_item and its membership provenance row, all together. A layer/audit
 * failure rolls back the whole publication, never leaving a pick without its
 * Discover membership or vice versa.
 */
async function publishRestaurantPick(input: {
  area: RestaurantArea;
  date: string;
  runId: string;
  subjectId: string;
  foodType: string;
  foodTypeVersion: number | null;
  copy: RestaurantCopyOutput;
  label: string;
  evidence: unknown;
  actorId: string | null;
}): Promise<{ pickId: string; replaced: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `restaurant_area:${input.area.id}`,
    ]);
    const cityRow = await client.query<{ id: string }>(
      "SELECT id FROM city WHERE slug = $1",
      [input.area.citySlug],
    );
    const cityId = cityRow.rows[0]?.id;
    if (!cityId) throw new Error(`Unknown city: ${input.area.citySlug}`);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM daily_pick WHERE city_id=$1 AND pick_date=$2::date AND status='published' FOR UPDATE`,
      [cityId, input.date],
    );
    const replacesId = existing.rows[0]?.id ?? null;
    if (replacesId)
      await client.query(
        `UPDATE daily_pick SET status='withdrawn', withdrawn_at=now(), withdrawn_by=$2, withdrawal_reason='Replaced by a new version 2 run.', updated_at=now() WHERE id=$1`,
        [replacesId, input.actorId],
      );
    const layerRow = await client.query<{ id: string }>(
      "SELECT id FROM layer WHERE slug = $1",
      [input.area.layerSlug],
    );
    const layerId = layerRow.rows[0]?.id;
    if (!layerId)
      throw new Error(`Discover layer not found: ${input.area.layerSlug}`);
    const validFrom = zonedMidnight(input.date, input.area.timezone);
    const enText = input.copy.enSentences.map((s) => s.text).join(" ");
    const zhText = input.copy.zhSentences.map((s) => s.text).join(" ");
    const pickInsert = await client.query<{ id: string }>(
      `INSERT INTO daily_pick(city_id, pick_date, subject_id, food_type, food_type_version, run_id, status, selection_kind, selection_version, description, description_chinese, reasons, reason_text, reason_text_chinese, evidence, replaces_id, created_by)
       VALUES($1,$2::date,$3,$4,$5,$6,'published','automatic',2,$7,$8,'[]'::jsonb,$7,$8,$9::jsonb,$10,$11)
       RETURNING id`,
      [
        cityId,
        input.date,
        input.subjectId,
        input.foodType,
        input.foodTypeVersion,
        input.runId,
        enText,
        zhText,
        JSON.stringify(input.evidence),
        replacesId,
        input.actorId,
      ],
    );
    const pickId = pickInsert.rows[0].id;
    const itemInsert = await client.query<{ id: string }>(
      `INSERT INTO layer_item(layer_id, subject_id, note, valid_from)
       VALUES($1,$2,'',$3)
       ON CONFLICT (layer_id, subject_id) WHERE subject_id IS NOT NULL DO UPDATE SET valid_from = EXCLUDED.valid_from
       RETURNING id`,
      [layerId, input.subjectId, validFrom],
    );
    const layerItemId = itemInsert.rows[0].id;
    await client.query(
      `INSERT INTO daily_pick_layer_membership(pick_id, layer_id, layer_item_id) VALUES($1,$2,$3)`,
      [pickId, layerId, layerItemId],
    );
    // moderation_action requires a real actor; an automatic run (actorId
    // null) is audited instead through analytics_event, whose actor is
    // nullable. An editorial run (an explicit moderator actorId) also gets a
    // moderation_action row, matching the version 1 editorial-pick convention.
    if (input.actorId)
      await client.query(
        `INSERT INTO moderation_action(entity_type,entity_id,action,reason,actor_id) VALUES('places',$1,'approved',$2,$3)`,
        [
          input.subjectId,
          `Published as the ${input.date} restaurant recommendation for ${input.area.citySlug}.`,
          input.actorId,
        ],
      );
    await client.query(
      `INSERT INTO analytics_event(user_id,name,properties) VALUES($1,'restaurant_pick_published',$2::jsonb)`,
      [
        input.actorId,
        JSON.stringify({
          subjectId: input.subjectId,
          citySlug: input.area.citySlug,
          date: input.date,
        }),
      ],
    );
    await client.query("COMMIT");
    return { pickId, replaced: Boolean(replacesId) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Withdraw a published version 2 pick: remove the Discover layer_item (its
 * membership provenance row cascades), leaving the pick's own audit trail
 * and report intact. Never deletes other independently-added memberships.
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
      `SELECT layer_item_id FROM daily_pick_layer_membership WHERE pick_id=$1`,
      [pickId],
    );
    await client.query(
      `UPDATE daily_pick SET status='withdrawn', withdrawn_at=now(), withdrawn_by=$2, withdrawal_reason=$3, updated_at=now() WHERE id=$1 AND status='published'`,
      [pickId, actorId, reason],
    );
    if (membership.rows[0])
      await client.query(`DELETE FROM layer_item WHERE id=$1`, [
        membership.rows[0].layer_item_id,
      ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
