import { z } from "zod";
import { localDate } from "./time";

/* ---------------------------------------------------------------------------
   Layer Suggestions (docs/adr/layer-suggestions-llm.md). Framework-free:
   the allowlisted prompt payload, its explicit serializer, and the output
   sanitizer. The sanitizer, not the prompt, is the security boundary: model
   output can only become short plain text citing facts that exist in the
   payload, attached to a layer the viewer already has.
   --------------------------------------------------------------------------- */

export const layerSuggestionPromptVersion = "v1";
export const maxLayerSuggestions = 3;
export const maxSuggestionTitle = 80;
export const maxSuggestionBody = 240;
export const maxPlaceNamesPerLayer = 20;
/** Names, titles and event titles are cut to this many characters. */
export const maxPromptNameLength = 80;
export const maxUpcomingEventsPerLayer = 5;
/** Layers serialized into one prompt, after filtering. */
export const maxSuggestionLayers = 24;
/** `listMapEvents` reads at most this many rows; reaching it means counts are incomplete. */
export const mapEventRowLimit = 500;
/** Fact IDs one suggestion may cite. */
const maxFactIdsPerSuggestion = 12;

export type SuggestionLocale = "en" | "zh-TW";

export type SuggestionFact = {
  /** "L1.f3": unique in the payload. */
  id: string;
  kind:
    | "visible_places"
    | "catalog_places"
    | "google_places"
    | "upcoming_event_count"
    | "schedule"
    | "place_name"
    | "upcoming_event";
  value: string | number;
};
export type SuggestionLayerPayload = {
  /** "L1" */
  ref: string;
  title: string;
  ownerKind: string;
  viewerRole: "owner" | "editor" | "viewer";
  /** City-local YYYY-MM-DD in this layer's time zone. */
  today: string;
  facts: SuggestionFact[];
};
export type LayerSuggestionPayload = {
  promptVersion: string;
  locale: SuggestionLocale;
  layers: SuggestionLayerPayload[];
};

/* ------------------------------ Wire schema ------------------------------ */

const wireSuggestion = z.object({
  layerRef: z.string(),
  title: z.string(),
  body: z.string(),
  factIds: z.array(z.string()),
});
/** Sent as the output format, so it carries no refinements and no union. */
export const layerSuggestionOutput = z.object({
  suggestions: z.array(wireSuggestion),
});
export type LayerSuggestionOutput = z.infer<typeof layerSuggestionOutput>;

/* ----------------------- Stored shape and type registry ----------------------- */

const storedLayerTip = z.object({
  type: z.literal("layer_tip"),
  layerRef: z.string(),
  title: z.string(),
  body: z.string(),
  factIds: z.array(z.string()),
});
/** Adding a suggestion type means one member here, one prompt line and one renderer. */
export const storedSuggestion = z.discriminatedUnion("type", [storedLayerTip]);
export const suggestionTypeRegistry = { layer_tip: storedLayerTip } as const;
export type StoredSuggestion = z.infer<typeof storedSuggestion>;
export const storedSuggestionList = z.array(storedSuggestion);

export class SuggestionOutputError extends Error {
  constructor(message = "The suggestion output was not usable.") {
    super(message);
    this.name = "SuggestionOutputError";
  }
}
export class SuggestionModelError extends Error {
  constructor(message = "The suggestion model call failed.") {
    super(message);
    this.name = "SuggestionModelError";
  }
}

/* -------------------------------- Sanitizer -------------------------------- */

const length = (text: string) => [...text].length;
const controlChars = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;
/** An address needs a dotted host: "Coffee@Home" and "Meet @ 5pm" are ordinary text. */
const emailPattern = /[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i;
/** Bare hosts only for common TLDs, so "Mr.Brown" and "Node.js" stay readable. */
const linkTlds =
  "com|net|org|io|co|tw|jp|app|dev|edu|gov|info|biz|xyz|ai|shop|site|online|cn|kr|uk";
const domainPattern = new RegExp(
  String.raw`(?:^|[^a-z0-9-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${linkTlds})(?![a-z0-9])`,
  "i",
);
/** True when the text could carry a link, markup, a domain or an address. */
export function containsLinkOrMarkup(text: string) {
  const t = text.normalize("NFKC");
  return (
    /https?:\/\//i.test(t) ||
    /\bwww\./i.test(t) ||
    /\[[^\]]*\]\([^)]*\)/.test(t) ||
    /<\/?[a-z!]/i.test(t) ||
    emailPattern.test(t) ||
    domainPattern.test(t)
  );
}
function cleanText(value: string, max: number): string | null {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text || length(text) > max) return null;
  // Control characters and bidi overrides have no place in a tip.
  if (controlChars.test(text)) return null;
  if (containsLinkOrMarkup(text)) return null;
  return text;
}

/**
 * Validates model output against the payload it was generated from. Each
 * entry is checked on its own, so one bad entry does not discard the rest.
 * `received` is how many entries the model returned before any were dropped.
 */
export function sanitizeLayerSuggestionsDetailed(
  raw: unknown,
  payload: LayerSuggestionPayload,
): { suggestions: StoredSuggestion[]; received: number; dropped: number } {
  const top = z.object({ suggestions: z.array(z.unknown()) }).safeParse(raw);
  if (!top.success) throw new SuggestionOutputError();
  const factsByRef = new Map(
    payload.layers.map((l) => [l.ref, new Set(l.facts.map((f) => f.id))]),
  );
  const out: StoredSuggestion[] = [];
  let dropped = 0;
  for (const entry of top.data.suggestions) {
    if (out.length >= maxLayerSuggestions) break;
    const before = out.length;
    keep(entry);
    if (out.length === before) dropped++;
  }
  return {
    suggestions: out,
    received: top.data.suggestions.length,
    dropped,
  };
  function keep(entry: unknown) {
    const parsed = wireSuggestion.safeParse(entry);
    if (!parsed.success) return;
    const { layerRef, title, body, factIds } = parsed.data;
    const known = factsByRef.get(layerRef);
    if (!known) return;
    if (
      !factIds.length ||
      factIds.length > maxFactIdsPerSuggestion ||
      !factIds.every((id) => known.has(id))
    )
      return;
    const cleanTitle = cleanText(title, maxSuggestionTitle);
    const cleanBody = cleanText(body, maxSuggestionBody);
    if (!cleanTitle || !cleanBody) return;
    out.push({
      type: "layer_tip",
      layerRef,
      title: cleanTitle,
      body: cleanBody,
      factIds: [...new Set(factIds)],
    });
  }
}
export function sanitizeLayerSuggestions(
  raw: unknown,
  payload: LayerSuggestionPayload,
): StoredSuggestion[] {
  return sanitizeLayerSuggestionsDetailed(raw, payload).suggestions;
}

/* -------------------------------- Serializer -------------------------------- */

/** Only these fields are read from the records the service passes in. */
export type SuggestionSourceLayer = {
  slug: string;
  title: string;
  titleChinese: string;
  ownerKind: string;
  schedule: string;
  startsOn: string | null;
  endsOn: string | null;
  timezone: string;
  canManage: boolean;
  canEdit: boolean;
};
export type SuggestionSourceItem = {
  key: string;
  name: string;
  nameChinese: string;
  isDemo: boolean;
  layers: string[];
};
export type SuggestionSourceExternal = {
  canonicalKey: string;
  layers: string[];
};
export type SuggestionSourceEvent = {
  key: string;
  layer: string;
  title: string;
  titleChinese: string;
  startTime: string;
  endTime: string;
};

/** Collapses whitespace, strips control characters and cuts to the prompt limit. */
export function promptText(value: string) {
  const text = value
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...text].slice(0, maxPromptNameLength).join("");
}
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The explicit allowlist serializer. Layers appear in the order given; names
 * are the first ones by ascending item key (so vote-driven rank changes do
 * not change the payload or its cache hash) and events sort by date, then key.
 * Events end-dated before the layer's local today are dropped.
 */
export function buildSuggestionPayload(input: {
  locale: SuggestionLocale;
  layers: SuggestionSourceLayer[];
  items: SuggestionSourceItem[];
  external: SuggestionSourceExternal[];
  events: SuggestionSourceEvent[];
  now: Date;
  /** The item list hit `maxMapPoints`: catalog counts would understate. */
  itemsTruncated: boolean;
  /** Event rows hit the read limit: event counts would understate. */
  eventsTruncated: boolean;
}): { payload: LayerSuggestionPayload; refs: Map<string, { slug: string }> } {
  const zh = input.locale === "zh-TW";
  const refs = new Map<string, { slug: string }>();
  const layers: SuggestionLayerPayload[] = [];
  const countEvents = !input.eventsTruncated && !input.itemsTruncated;
  for (const [index, layer] of input.layers
    .slice(0, maxSuggestionLayers)
    .entries()) {
    const ref = `L${index + 1}`;
    refs.set(ref, { slug: layer.slug });
    const today = localDate(input.now, layer.timezone);
    const items = input.items
      .filter((i) => !i.isDemo && i.layers.includes(layer.slug))
      .sort((a, b) => byCodeUnit(a.key, b.key));
    const external = input.external.filter((e) =>
      e.layers.includes(layer.slug),
    );
    const visibleKeys = new Set([
      ...items.map((i) => i.key),
      ...external.map((e) => e.canonicalKey),
    ]);
    const events = input.events
      .filter(
        (e) =>
          e.layer === layer.slug &&
          visibleKeys.has(e.key) &&
          localDate(new Date(e.endTime), layer.timezone) >= today,
      )
      .map((e) => {
        const start = localDate(new Date(e.startTime), layer.timezone);
        // A started event is "ongoing", never given its past start date, so
        // the model cannot call it upcoming.
        const ongoing = start < today;
        return {
          key: e.key,
          date: ongoing ? today : start,
          ongoing,
          title: promptText((zh && e.titleChinese) || e.title),
        };
      })
      .sort((a, b) => byCodeUnit(a.date, b.date) || byCodeUnit(a.key, b.key));
    const raw: Omit<SuggestionFact, "id">[] = [];
    if (!input.itemsTruncated) {
      raw.push({
        kind: "visible_places",
        value: items.length + external.length,
      });
      raw.push({ kind: "catalog_places", value: items.length });
    }
    raw.push({ kind: "google_places", value: external.length });
    if (countEvents)
      raw.push({ kind: "upcoming_event_count", value: events.length });
    raw.push({
      kind: "schedule",
      value:
        layer.startsOn || layer.endsOn
          ? `${layer.schedule} ${layer.startsOn ?? ""}..${layer.endsOn ?? ""}`
          : layer.schedule,
    });
    for (const item of items.slice(0, maxPlaceNamesPerLayer))
      raw.push({
        kind: "place_name",
        value: promptText((zh && item.nameChinese) || item.name),
      });
    for (const event of events.slice(0, maxUpcomingEventsPerLayer))
      raw.push({
        kind: "upcoming_event",
        value: event.ongoing
          ? `ongoing ${event.title}`
          : `${event.date} ${event.title}`,
      });
    layers.push({
      ref,
      title: promptText((zh && layer.titleChinese) || layer.title),
      ownerKind: layer.ownerKind,
      viewerRole: layer.canManage
        ? "owner"
        : layer.canEdit
          ? "editor"
          : "viewer",
      today,
      facts: raw.map((f, n) => ({ id: `${ref}.f${n + 1}`, ...f })),
    });
  }
  return {
    payload: {
      promptVersion: layerSuggestionPromptVersion,
      locale: input.locale,
      layers,
    },
    refs,
  };
}
