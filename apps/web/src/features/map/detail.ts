import {
  AppError,
  customPlaceKey,
  parseItemKey,
  type Actor,
} from "@taiwanhub/shared";
import { getContent, getState, type Content } from "../catalog/repository";
import { eventStateOf, type EventState } from "../catalog/event-state";
import { getContentPost, type ContentPost } from "../content/repository";
import { listEditableLayers } from "../layers/repository";
import {
  findCustomPlace,
  getVisibleCustomPlace,
  scopeAccess,
  type CustomPlace,
} from "../custom-places/repository";
import { flags } from "@/lib/config";
export type ItemDetail =
  | {
      type: "custom";
      item: null;
      state: { saved: false; going: false; following: false; vote: null };
      eventState: "open";
      post: null;
      place: CustomPlace;
      /** Scope owners and group editors may edit or delete the place itself. */
      canEdit: boolean;
      editableLayers: EditableLayer[];
    }
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
  const customId = customPlaceKey(key);
  if (customId) return customDetail(customId, actor);
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
/**
 * A custom place is readable by its owner scope or through a viewable layer.
 * It can be added only to layers of the same owner and city.
 */
async function customDetail(
  id: string,
  actor: Actor | null,
): Promise<ItemDetail> {
  if (!flags.layerCustomPlaces)
    throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
  const place = await getVisibleCustomPlace(id, actor);
  const row = place ? await findCustomPlace(id) : null;
  if (!place || !row)
    throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
  const access = await scopeAccess(row, actor);
  let editableLayers: EditableLayer[] = [];
  if (actor && flags.layerWrites && access === "edit") {
    const { pool } = await import("@taiwanhub/database");
    const layers = (await listEditableLayers(actor)).filter(
      (l) =>
        l.cityId === row.city_id &&
        (row.owner_user_id
          ? l.ownerKind === "user" && l.ownerUserId === row.owner_user_id
          : l.ownerKind === "group" && l.ownerGroupId === row.owner_group_id),
    );
    const contains = await pool.query<{ layer_id: string }>(
      "SELECT layer_id FROM layer_item WHERE custom_place_id=$1 AND layer_id=ANY($2::uuid[])",
      [id, layers.map((l) => l.id)],
    );
    const has = new Set(contains.rows.map((r) => r.layer_id));
    editableLayers = layers.map((l) => ({
      id: l.id,
      slug: l.slug,
      title: l.title,
      titleChinese: l.titleChinese,
      audience: l.audience,
      citySlug: l.citySlug,
      contains: has.has(l.id),
    }));
  }
  return {
    type: "custom",
    item: null,
    state: { saved: false, going: false, following: false, vote: null },
    eventState: "open",
    post: null,
    place,
    canEdit: access === "edit",
    editableLayers,
  };
}
