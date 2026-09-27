import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import type { Actor } from "@taiwanhub/shared";
import {
  getLayer,
  getMemberships,
  type LayerRecord,
} from "@/features/layers/repository";
type Queryable = Pick<PoolClient, "query">;
/**
 * Member-created places (docs/plans/layer-scoped-places-design.md). A custom
 * place belongs to one user or one group and is readable only by that scope
 * and by viewers of a layer that contains it. It never enters catalog search,
 * city-wide map results, sitemaps or public place pages.
 */
export type CustomPlaceRow = {
  id: string;
  owner_user_id: string | null;
  owner_group_id: string | null;
  city_id: string;
  name: string;
  name_chinese: string;
  address: string;
  location_status: "exact" | "approximate" | "unspecified";
  latitude: number | null;
  longitude: number | null;
  category_id: string | null;
  website: string;
  note: string;
  catalog_place_id: string | null;
  status: "active" | "hidden" | "deleted";
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  /** Status of the linked catalog proposal, when selected with `columns`. */
  suggestion_status?: string | null;
};
export type SuggestionState = "none" | "pending" | "approved" | "rejected";
export type CustomPlace = {
  id: string;
  key: `custom:${string}`;
  ownerKind: "user" | "group";
  cityId: string;
  name: string;
  nameChinese: string;
  address: string;
  locationStatus: CustomPlaceRow["location_status"];
  latitude: number | null;
  longitude: number | null;
  categoryId: string | null;
  website: string;
  note: string;
  updatedAt: string;
  /** Opt-in catalog suggestion; an approved one replaces this place on the map. */
  suggestion: SuggestionState;
  catalogPlaceId: string | null;
};
const columns =
  "id,owner_user_id,owner_group_id,city_id,name,name_chinese,address,location_status,latitude,longitude,category_id,website,note,catalog_place_id,status,created_by,created_at,updated_at,(SELECT p.status FROM place p WHERE p.id=custom_place.catalog_place_id) AS suggestion_status";
function suggestionOf(status: string | null | undefined): SuggestionState {
  if (!status) return "none";
  if (status === "pending" || status === "approved") return status;
  return "rejected";
}
export function toCustomPlace(row: CustomPlaceRow): CustomPlace {
  return {
    id: row.id,
    key: `custom:${row.id}`,
    ownerKind: row.owner_group_id ? "group" : "user",
    cityId: row.city_id,
    name: row.name,
    nameChinese: row.name_chinese,
    address: row.address,
    locationStatus: row.location_status,
    latitude: row.latitude,
    longitude: row.longitude,
    categoryId: row.category_id,
    website: row.website,
    note: row.note,
    updatedAt: row.updated_at.toISOString(),
    suggestion: suggestionOf(row.suggestion_status),
    catalogPlaceId: row.catalog_place_id,
  };
}
export async function findCustomPlace(
  id: string,
  db: Queryable = pool,
  lock = false,
) {
  const result = await db.query<CustomPlaceRow>(
    `SELECT ${columns} FROM custom_place WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return result.rows[0] ?? null;
}
/** The actor's role in the place's owner scope: edit (owner / group owner or editor), view (group viewer) or none. */
export async function scopeAccess(
  row: Pick<CustomPlaceRow, "owner_user_id" | "owner_group_id">,
  actor: Actor | null,
): Promise<"edit" | "view" | null> {
  if (!actor) return null;
  if (row.owner_user_id) return row.owner_user_id === actor.id ? "edit" : null;
  const role = (await getMemberships(actor.id)).get(row.owner_group_id!);
  if (!role) return null;
  return role === "viewer" ? "view" : "edit";
}
/**
 * An active place readable by the actor: its owner scope, or anyone who can
 * view at least one layer containing it (e.g. an approved public layer).
 */
export async function getVisibleCustomPlace(id: string, actor: Actor | null) {
  const row = await findCustomPlace(id);
  if (!row || row.status !== "active") return null;
  if (await scopeAccess(row, actor)) return toCustomPlace(row);
  const layers = await pool.query<{ layer_id: string }>(
    "SELECT layer_id FROM layer_item WHERE custom_place_id=$1",
    [id],
  );
  for (const { layer_id } of layers.rows) {
    const found = await getLayer(layer_id, actor);
    if (found?.access.view) return toCustomPlace(row);
  }
  return null;
}
/** Active places by id. Callers must already have authorized the layers holding them. */
export async function listActiveCustomPlaces(ids: string[]) {
  if (!ids.length) return [];
  const result = await pool.query<CustomPlaceRow>(
    `SELECT ${columns} FROM custom_place WHERE id=ANY($1::uuid[]) AND status='active'`,
    [ids],
  );
  return result.rows.map(toCustomPlace);
}
/** The layer owner's active places in the layer's city, for the editor's "Your places" search. */
export async function listScopePlaces(layer: LayerRecord, q: string) {
  const owner =
    layer.ownerKind === "user"
      ? { column: "owner_user_id", id: layer.ownerUserId }
      : layer.ownerKind === "group"
        ? { column: "owner_group_id", id: layer.ownerGroupId }
        : null;
  if (!owner?.id) return [];
  const pattern = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const result = await pool.query<CustomPlaceRow>(
    `SELECT ${columns} FROM custom_place
     WHERE ${owner.column}=$1 AND city_id=$2 AND status='active'
       AND ($3 = '%%' OR name ILIKE $3 OR name_chinese ILIKE $3 OR address ILIKE $3)
     ORDER BY updated_at DESC LIMIT 30`,
    [owner.id, layer.cityId, pattern],
  );
  return result.rows.map(toCustomPlace);
}
