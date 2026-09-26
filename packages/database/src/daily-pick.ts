import type { PoolClient } from "pg";
import { pool } from "./index";
import {
  dailyPickSelectionVersion,
  isCalendarDate,
  localDate,
  renderDailyPickReasons,
  selectDailyPick,
  summarizeDescription,
  type DailyPickCandidate,
  type DailyPickHistoryEntry,
  type DailyPickReason,
} from "../../shared/src";
/**
 * Daily Pick persistence shared by the scheduled job and the moderator
 * service. One published row per city/local date (partial unique index); every
 * write takes a transaction-scoped advisory lock on the slot first so the job
 * and moderators serialize instead of racing.
 */
export type DailyPickCity = { id: string; slug: string; timezone: string };
export async function lockDailyPickSlot(
  client: PoolClient,
  cityId: string,
  date: string,
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `daily_pick:${cityId}:${date}`,
  ]);
}
const candidateColumns = `p.id,p.status,p.is_demo,p.city_id,p.category,p.neighborhood,p.description,p.description_chinese,p.address,p.latitude,p.longitude,p.source,p.website,p.hours,p.verification_status,
  (SELECT r.source_url FROM entity_source es JOIN source_record r ON r.id=es.source_record_id WHERE es.kind='places' AND es.entity_id=p.id ORDER BY es.updated_at DESC LIMIT 1) AS provenance_url,
  (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id=p.id AND r.status='approved') AS responses,
  (SELECT count(*)::int FROM place_recommendation r WHERE r.place_id=p.id AND r.status='approved' AND r.positive) AS positive`;
function candidate(row: Record<string, unknown>): DailyPickCandidate {
  return {
    id: String(row.id),
    status: String(row.status),
    isDemo: Boolean(row.is_demo),
    cityId: String(row.city_id),
    category: String(row.category ?? ""),
    neighborhood: String(row.neighborhood ?? ""),
    description: String(row.description ?? ""),
    descriptionChinese: String(row.description_chinese ?? ""),
    address: String(row.address ?? ""),
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    source: String(row.source ?? ""),
    website: (row.website as string | null) || null,
    provenanceUrl: (row.provenance_url as string | null) || null,
    hours: (row.hours as string | null) || null,
    verificationStatus: String(row.verification_status ?? "UNVERIFIED"),
    positive: Number(row.positive ?? 0),
    responses: Number(row.responses ?? 0),
  };
}
/** Public, non-demo catalog places of the city; eligibility is finished by the shared rules. */
export async function loadDailyPickCandidates(
  client: PoolClient,
  cityId: string,
) {
  const result = await client.query<Record<string, unknown>>(
    `SELECT ${candidateColumns} FROM place p WHERE p.city_id=$1 AND p.status='approved' AND NOT p.is_demo ORDER BY p.id LIMIT 5000`,
    [cityId],
  );
  return result.rows.map(candidate);
}
/** One place as a candidate regardless of status, for editorial checks. */
export async function loadDailyPickCandidate(
  client: PoolClient,
  placeId: string,
) {
  const result = await client.query<Record<string, unknown>>(
    `SELECT ${candidateColumns} FROM place p WHERE p.id=$1`,
    [placeId],
  );
  return result.rows[0] ? candidate(result.rows[0]) : null;
}
/** Published picks of the city on every other date, for repeat and diversity rules. */
export async function loadDailyPickHistory(
  client: PoolClient,
  cityId: string,
  date: string,
): Promise<DailyPickHistoryEntry[]> {
  const result = await client.query<{
    date: string;
    place_id: string;
    category: string;
    neighborhood: string;
  }>(
    `SELECT d.pick_date::text AS date,d.place_id,p.category,p.neighborhood FROM daily_pick d JOIN place p ON p.id=d.place_id WHERE d.city_id=$1 AND d.status='published' AND d.pick_date<>$2::date ORDER BY d.pick_date DESC`,
    [cityId, date],
  );
  return result.rows.map((r) => ({
    date: r.date,
    placeId: r.place_id,
    category: r.category,
    neighborhood: r.neighborhood,
  }));
}
/** The published row for a slot, locked, with the place's current public visibility. */
export async function lockedPublishedPick(
  client: PoolClient,
  cityId: string,
  date: string,
) {
  const result = await client.query<{
    id: string;
    place_id: string;
    visible: boolean;
  }>(
    `SELECT d.id,d.place_id,(p.status='approved' AND NOT p.is_demo AND p.city_id=d.city_id) AS visible FROM daily_pick d JOIN place p ON p.id=d.place_id WHERE d.city_id=$1 AND d.pick_date=$2::date AND d.status='published' FOR UPDATE OF d`,
    [cityId, date],
  );
  return result.rows[0] ?? null;
}
export async function withdrawDailyPick(
  client: PoolClient,
  id: string,
  reason: string,
  actorId: string | null,
) {
  await client.query(
    `UPDATE daily_pick SET status='withdrawn',withdrawn_at=now(),withdrawn_by=$2,withdrawal_reason=$3,updated_at=now() WHERE id=$1 AND status='published'`,
    [id, actorId, reason],
  );
}
/** Insert a published pick with dated bilingual snapshots; null if the slot is already taken. */
export async function insertDailyPick(
  client: PoolClient,
  input: {
    cityId: string;
    date: string;
    place: DailyPickCandidate;
    selectionKind: "automatic" | "editorial";
    reasons: DailyPickReason[];
    evidence: Record<string, unknown>;
    replacesId: string | null;
    createdBy: string | null;
  },
) {
  const { place } = input;
  const result = await client.query<{ id: string }>(
    `INSERT INTO daily_pick(city_id,pick_date,place_id,selection_kind,selection_version,description,description_chinese,reasons,reason_text,reason_text_chinese,evidence,replaces_id,created_by)
     VALUES($1,$2::date,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12,$13)
     ON CONFLICT (city_id,pick_date) WHERE status='published' DO NOTHING RETURNING id`,
    [
      input.cityId,
      input.date,
      place.id,
      input.selectionKind,
      dailyPickSelectionVersion,
      summarizeDescription(place.description),
      place.descriptionChinese.trim()
        ? summarizeDescription(place.descriptionChinese)
        : "",
      JSON.stringify(input.reasons),
      renderDailyPickReasons(input.reasons, "en"),
      renderDailyPickReasons(input.reasons, "zh-TW"),
      JSON.stringify({
        ...input.evidence,
        place: {
          source: place.source,
          website: place.website,
          provenanceUrl: place.provenanceUrl,
          category: place.category,
          neighborhood: place.neighborhood,
        },
      }),
      input.replacesId,
      input.createdBy,
    ],
  );
  return result.rows[0]?.id ?? null;
}
export type DailyPickRunResult = {
  city: string;
  date: string;
  status: "created" | "replaced" | "unchanged" | "empty";
  pickId: string | null;
  placeId: string | null;
  withdrawnId?: string;
  reason?: string;
};
export type DailyPickGenerateOptions = {
  /** Recorded as withdrawn_by on an automatic withdrawal; null for the scheduled job. */
  actorId?: string | null;
  /**
   * Runs inside the same transaction after any change (withdrawal, new pick
   * or both) and before commit; if it throws, every effect rolls back.
   */
  onChange?: (client: PoolClient, result: DailyPickRunResult) => Promise<void>;
};
/**
 * Idempotent: an existing visible pick is kept; a pick whose place is no
 * longer public is withdrawn and replaced (or left empty, honestly). Never
 * selects from a map result set — always from the city-wide catalog.
 */
export async function generateDailyPick(
  city: DailyPickCity,
  date: string,
  options: DailyPickGenerateOptions = {},
): Promise<DailyPickRunResult> {
  const client = await pool.connect();
  const finish = async (result: DailyPickRunResult) => {
    if (result.status !== "unchanged" && (result.pickId || result.withdrawnId))
      await options.onChange?.(client, result);
    await client.query("COMMIT");
    return result;
  };
  try {
    await client.query("BEGIN");
    await lockDailyPickSlot(client, city.id, date);
    const existing = await lockedPublishedPick(client, city.id, date);
    if (existing?.visible)
      return await finish({
        city: city.slug,
        date,
        status: "unchanged",
        pickId: existing.id,
        placeId: existing.place_id,
      });
    if (existing)
      await withdrawDailyPick(
        client,
        existing.id,
        "The place is no longer publicly visible.",
        options.actorId ?? null,
      );
    const [candidates, history] = await Promise.all([
      loadDailyPickCandidates(client, city.id),
      loadDailyPickHistory(client, city.id, date),
    ]);
    const selection = selectDailyPick({
      cityId: city.id,
      date,
      candidates,
      history,
    });
    if (selection.placeId === null)
      return await finish({
        city: city.slug,
        date,
        status: "empty",
        pickId: null,
        placeId: null,
        withdrawnId: existing?.id,
        reason: selection.reason,
      });
    const place = candidates.find((c) => c.id === selection.placeId)!;
    const pickId = await insertDailyPick(client, {
      cityId: city.id,
      date,
      place,
      selectionKind: "automatic",
      reasons: selection.reasons,
      evidence: selection.evidence,
      replacesId: existing?.id ?? null,
      createdBy: null,
    });
    return await finish({
      city: city.slug,
      date,
      status: existing ? "replaced" : "created",
      pickId,
      placeId: place.id,
      withdrawnId: existing?.id,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
/**
 * Generate for one city or all cities. The default date is each city's own
 * local today; an explicit date may not be in that city's past.
 */
export async function runDailyPickGeneration(
  options: { citySlug?: string; date?: string; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  if (options.date !== undefined && !isCalendarDate(options.date))
    throw new Error(`Invalid date: ${options.date}. Use YYYY-MM-DD.`);
  const cities = (
    await pool.query<DailyPickCity>(
      options.citySlug
        ? "SELECT id,slug,timezone FROM city WHERE slug=$1"
        : "SELECT id,slug,timezone FROM city ORDER BY slug",
      options.citySlug ? [options.citySlug] : [],
    )
  ).rows;
  if (options.citySlug && !cities.length)
    throw new Error(`Unknown city: ${options.citySlug}`);
  const results: DailyPickRunResult[] = [];
  const errors: { city: string; message: string }[] = [];
  for (const city of cities) {
    const today = localDate(now, city.timezone);
    const date = options.date ?? today;
    if (date < today) {
      errors.push({
        city: city.slug,
        message: `Refusing to generate for ${date}, before ${city.slug}'s local today (${today}).`,
      });
      continue;
    }
    try {
      results.push(await generateDailyPick(city, date));
    } catch (error) {
      errors.push({ city: city.slug, message: (error as Error).message });
    }
  }
  return { results, errors };
}
