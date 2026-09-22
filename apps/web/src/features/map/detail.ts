import { AppError, parseItemKey, type Actor } from "@taiwanhub/shared";
import { getContent, getState, type Content } from "../catalog/repository";
import { eventStateOf, type EventState } from "../catalog/event-state";
import { getContentPost, type ContentPost } from "../content/repository";
import { listEditableLayers } from "../layers/repository";
import { flags } from "@/lib/config";
export type ItemDetail =
  | {
      type: "place" | "event";
      item: Content;
      state: Awaited<ReturnType<typeof getState>>;
      eventState: EventState;
      post: null;
      editableLayers: EditableLayer[];
    }
  | {
      type: "content";
      item: null;
      state: { saved: boolean; going: false; following: false; vote: null };
      eventState: "open";
      post: ContentPost;
      editableLayers: EditableLayer[];
    };
export type EditableLayer = {
  id: string;
  slug: string;
  title: string;
  titleChinese: string;
  audience: string;
  citySlug: string;
  contains: boolean;
};
/** Loaded only when an item is selected; reuses the canonical detail queries. */
export async function getMapItemDetail(
  key: string,
  actor: Actor | null,
): Promise<ItemDetail> {
  const parsed = parseItemKey(key);
  if (!parsed) throw new AppError(400, "INVALID_ITEM", "Unknown item.");
  const editableLayers =
    actor && flags.layerWrites ? await editableFor(actor, key) : [];
  if (parsed.type === "content") {
    if (!flags.content)
      throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
    const post = await getContentPost(parsed.id, actor);
    return {
      type: "content",
      item: null,
      state: { saved: post.saved, going: false, following: false, vote: null },
      eventState: "open",
      post,
      editableLayers,
    };
  }
  const kind = parsed.type === "place" ? "places" : "events";
  const item = await getContent(kind, parsed.id);
  const state = await getState(kind, item.id, actor?.id);
  return {
    type: parsed.type,
    item,
    state,
    eventState: kind === "events" ? eventStateOf(item) : "open",
    post: null,
    editableLayers,
  };
}
/** Layers the actor can add this item to, with existing membership marked. */
export async function editableFor(
  actor: Actor,
  key: string,
): Promise<EditableLayer[]> {
  const parsed = parseItemKey(key)!;
  const layers = await listEditableLayers(actor);
  if (!layers.length) return [];
  const { pool } = await import("@taiwanhub/database");
  const column =
    parsed.type === "place"
      ? "place_id"
      : parsed.type === "event"
        ? "event_id"
        : "content_id";
  const contains = await pool.query<{ layer_id: string }>(
    `SELECT layer_id FROM layer_item WHERE ${column}=$1 AND layer_id=ANY($2::uuid[])`,
    [parsed.id, layers.map((l) => l.id)],
  );
  const has = new Set(contains.rows.map((r) => r.layer_id));
  return layers.map((l) => ({
    id: l.id,
    slug: l.slug,
    title: l.title,
    titleChinese: l.titleChinese,
    audience: l.audience,
    citySlug: l.citySlug,
    contains: has.has(l.id),
  }));
}
