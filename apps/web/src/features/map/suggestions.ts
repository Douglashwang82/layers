import { createHash } from "node:crypto";
import {
  createLayerSuggestionModel,
  pool,
  requireLayerSuggestionsModel,
  type LayerSuggestionModel,
} from "@taiwanhub/database";
import {
  AppError,
  buildSuggestionPayload,
  mapEventRowLimit,
  maxMapPoints,
  requireActor,
  sanitizeLayerSuggestionsDetailed,
  storedSuggestionList,
  layerSuggestionPromptVersion,
  type Actor,
  type LayerSuggestionPayload,
  type MapState,
  type StoredSuggestion,
  type SuggestionLocale,
} from "@taiwanhub/shared";
import { resolveAppliedLayers } from "./applied";
import { collectExternalReferences } from "./external";
import { runMapQuery, type MapCity } from "./query";

/* ---------------------------------------------------------------------------
   Layer Suggestions service (docs/adr/layer-suggestions-llm.md). Builds the
   allowlisted snapshot of the viewer's selected layers, caches model output
   per user and snapshot hash, and spends a rate-limit budget only on a miss.
   --------------------------------------------------------------------------- */

export const suggestionCacheHours = 24;
export const suggestionUserBudget = { key: "user", limit: 10, minutes: 60 };
export const suggestionGlobalBudget = { limit: 500, minutes: 1440 };
const sweepBatch = 100;

type City = MapCity;
export type SuggestionView = {
  type: "layer_tip";
  title: string;
  body: string;
  layerSlug: string;
};
export type LayerSuggestionsResult =
  /** `reason: "no_layers"`: nothing the viewer selected can have suggestions. */
  | { status: "none"; reason?: "no_layers" }
  | { status: "ready"; generatedAt: string; suggestions: SuggestionView[] };
export type SuggestionDeps = { model: LayerSuggestionModel; modelId: string };

export type SuggestionSnapshot = {
  payload: LayerSuggestionPayload;
  refs: Map<string, { slug: string }>;
};

/**
 * The allowlisted snapshot, or null when the state selects no usable layer.
 * `state` comes from resolveMapRequest, so the MVP scope is already applied.
 * Nothing but the serializer's fields reaches the payload.
 */
export async function buildSuggestionSnapshot(
  state: MapState,
  city: City,
  actor: Actor,
  locale: SuggestionLocale,
  now: Date,
): Promise<SuggestionSnapshot | null> {
  const applied = await resolveAppliedLayers(state, actor, city);
  const usable = applied.resolved.filter(
    ({ layer }) =>
      layer.ownerKind !== "system" &&
      layer.rule?.kind !== "saves" &&
      layer.lifecycle !== "archived",
  );
  if (!usable.length) return null;
  const result = await runMapQuery(state, city, actor, now);
  const external = await collectExternalReferences(state, city, actor, now);
  const events = Object.values(result.events).flat();
  return buildSuggestionPayload({
    locale,
    layers: usable.map(({ layer, access }) => ({
      slug: layer.slug,
      title: layer.title,
      titleChinese: layer.titleChinese,
      ownerKind: layer.ownerKind,
      schedule: layer.schedule,
      startsOn: layer.startsOn,
      endsOn: layer.endsOn,
      timezone: layer.timezone,
      canManage: access.manage,
      canEdit: access.edit,
    })),
    items: result.items,
    external,
    events,
    now,
    itemsTruncated: result.items.length >= maxMapPoints,
    eventsTruncated: events.length >= mapEventRowLimit,
  });
}

/** Model and key from the environment; null when either is unset or invalid. */
function configuredModel(): { apiKey: string; modelId: string } | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    return {
      apiKey,
      modelId: requireLayerSuggestionsModel(
        process.env.LAYER_SUGGESTIONS_LLM_MODEL,
      ),
    };
  } catch {
    return null;
  }
}

export function snapshotHash(payload: LayerSuggestionPayload, model: string) {
  return createHash("sha256")
    .update(JSON.stringify({ payload, model }))
    .digest("hex");
}

function toViews(
  stored: StoredSuggestion[],
  refs: Map<string, { slug: string }>,
): SuggestionView[] {
  return stored.flatMap((s) => {
    const layer = refs.get(s.layerRef);
    return layer
      ? [
          {
            type: s.type,
            title: s.title,
            body: s.body,
            layerSlug: layer.slug,
          },
        ]
      : [];
  });
}

async function readCache(
  userId: string,
  hash: string,
  refs: SuggestionSnapshot["refs"],
): Promise<LayerSuggestionsResult | null> {
  const row = await pool.query<{ suggestions: unknown; created_at: Date }>(
    `SELECT suggestions, created_at FROM layer_suggestion_run
     WHERE user_id=$1 AND snapshot_hash=$2 AND expires_at > now()`,
    [userId, hash],
  );
  if (!row.rows[0]) return null;
  const parsed = storedSuggestionList.safeParse(row.rows[0].suggestions);
  if (!parsed.success) return null;
  return {
    status: "ready",
    generatedAt: row.rows[0].created_at.toISOString(),
    suggestions: toViews(parsed.data, refs),
  };
}

/** The cached result for the current selection, or `none`. Never calls the model. */
export async function getLayerSuggestions(
  state: MapState,
  city: City,
  actor: Actor | null,
  locale: SuggestionLocale,
  now = new Date(),
  deps?: Pick<SuggestionDeps, "modelId">,
): Promise<LayerSuggestionsResult> {
  if (!actor) return { status: "none" };
  const modelId = deps?.modelId ?? configuredModel()?.modelId;
  if (!modelId) return { status: "none" };
  const snapshot = await buildSuggestionSnapshot(
    state,
    city,
    actor,
    locale,
    now,
  );
  if (!snapshot) return { status: "none", reason: "no_layers" };
  return (
    (await readCache(
      actor.id,
      snapshotHash(snapshot.payload, modelId),
      snapshot.refs,
    )) ?? { status: "none" }
  );
}

async function spend(key: string, limit: number, minutes: number) {
  const result = await pool.query<{ count: number }>(
    `INSERT INTO rate_limit(key,count,expires_at) VALUES($1,1,now()+make_interval(mins=>$2::int))
     ON CONFLICT(key) DO UPDATE SET
       count=CASE WHEN rate_limit.expires_at<now() THEN 1 ELSE rate_limit.count+1 END,
       expires_at=CASE WHEN rate_limit.expires_at<now() THEN now()+make_interval(mins=>$2::int) ELSE rate_limit.expires_at END
     RETURNING count`,
    [key, minutes],
  );
  if (result.rows[0].count > limit)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Suggestions are busy right now. Please try again later.",
    );
}

/**
 * Generates (or serves from cache) suggestions for the current selection.
 * Budget is spent only on a cache miss, user budget first so a user over
 * budget never touches the global counter. `deps` is the test seam and skips
 * the environment checks; there is no server-side fake.
 */
export async function generateLayerSuggestions(
  state: MapState,
  city: City,
  actor: Actor | null,
  locale: SuggestionLocale,
  deps?: SuggestionDeps,
  now = new Date(),
): Promise<LayerSuggestionsResult> {
  const a = requireActor(actor);
  const config = deps ? null : configuredModel();
  if (!deps && !config)
    throw new AppError(
      503,
      "SUGGESTIONS_UNAVAILABLE",
      "Suggestions are unavailable.",
    );
  const modelId = deps?.modelId ?? config!.modelId;
  const snapshot = await buildSuggestionSnapshot(state, city, a, locale, now);
  if (!snapshot) return { status: "none", reason: "no_layers" };
  const hash = snapshotHash(snapshot.payload, modelId);
  const cached = await readCache(a.id, hash, snapshot.refs);
  if (cached) return cached;
  await spend(
    `layer-suggestions:user:${a.id}`,
    suggestionUserBudget.limit,
    suggestionUserBudget.minutes,
  );
  await spend(
    "layer-suggestions:global",
    suggestionGlobalBudget.limit,
    suggestionGlobalBudget.minutes,
  );
  const model =
    deps?.model ??
    createLayerSuggestionModel({
      apiKey: config!.apiKey,
      model: config!.modelId,
    });
  let stored: StoredSuggestion[];
  try {
    const raw = await model.generate(snapshot.payload);
    const { suggestions, received, dropped } = sanitizeLayerSuggestionsDetailed(
      raw,
      snapshot.payload,
    );
    // Counts only, never text, so an all-dropped failure is visible.
    if (dropped > 0)
      console.warn(
        `layer-suggestions: kept ${suggestions.length} of ${received}, dropped ${dropped}`,
      );
    // Entries that were all dropped are a failure, not "nothing to suggest".
    if (received > 0 && !suggestions.length) throw new Error("all dropped");
    stored = suggestions;
  } catch {
    throw new AppError(
      502,
      "SUGGESTIONS_FAILED",
      "Suggestions could not be generated. Please try again.",
    );
  }
  const written = await pool.query<{ created_at: Date }>(
    `INSERT INTO layer_suggestion_run
       (user_id,snapshot_hash,locale,suggestions,model,prompt_version,created_at,expires_at)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,now(),now()+make_interval(hours=>$7::int))
     ON CONFLICT (user_id,snapshot_hash) DO UPDATE SET
       locale=EXCLUDED.locale, suggestions=EXCLUDED.suggestions, model=EXCLUDED.model,
       prompt_version=EXCLUDED.prompt_version, created_at=EXCLUDED.created_at,
       expires_at=EXCLUDED.expires_at
     RETURNING created_at`,
    [
      a.id,
      hash,
      locale,
      JSON.stringify(stored),
      modelId,
      layerSuggestionPromptVersion,
      suggestionCacheHours,
    ],
  );
  // Best-effort: a failed sweep must never turn a paid success into an error.
  try {
    await pool.query(
      `DELETE FROM layer_suggestion_run WHERE ctid IN (
         SELECT ctid FROM layer_suggestion_run WHERE expires_at < now()
         LIMIT ${sweepBatch} FOR UPDATE SKIP LOCKED)`,
    );
  } catch {
    // Expired rows are never served; the next write sweeps again.
  }
  return {
    status: "ready",
    generatedAt: written.rows[0].created_at.toISOString(),
    suggestions: toViews(stored, snapshot.refs),
  };
}
