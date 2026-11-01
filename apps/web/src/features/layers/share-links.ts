import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  requireActor,
  type Actor,
  type LayerReviewStatus,
} from "@taiwanhub/shared";
import { flags, appUrl } from "@/lib/config";
import { trackEvent } from "@/lib/analytics";
import { generateOpaqueToken, hashToken } from "@/features/membership/crypto";
import { getLayer, type LayerRecord } from "./repository";

/*
 * Read-only "anyone with the link can view" sharing. The token is the only
 * credential: only its SHA-256 is stored, the raw value is returned once on
 * creation, and every dead state (unknown, revoked, archived, hidden, owner no
 * longer able to manage) answers identically so a link never reveals whether
 * a layer exists. An archived layer's link is kept, so restoring it revives it.
 */

/** 27 base64url characters are issued; the bounds reject junk before hashing. */
const tokenShape = /^[A-Za-z0-9_-]{20,64}$/;
export function isShareTokenShape(token: unknown): token is string {
  return typeof token === "string" && tokenShape.test(token);
}
export function shareUrl(token: string) {
  return `${appUrl.replace(/\/$/, "")}/shared/${token}`;
}
const deadReviewStatuses: readonly LayerReviewStatus[] = ["hidden", "rejected"];
/**
 * Whether a link may still show its layer. `creatorCanManage` is the link
 * creator's current manage access (owner of a user layer, owner of the group
 * for a group layer), so demoting or removing them kills the link.
 */
export function shareLinkLive(input: {
  lifecycle: string;
  reviewStatus: LayerReviewStatus;
  ownerKind: string;
  createdBy: string | null;
  creatorCanManage: boolean;
}) {
  return (
    input.ownerKind !== "system" &&
    input.lifecycle !== "archived" &&
    !deadReviewStatuses.includes(input.reviewStatus) &&
    input.createdBy !== null &&
    input.creatorCanManage
  );
}

function writable() {
  if (!flags.layerWrites)
    throw new AppError(404, "DISABLED", "Layer editing is unavailable.");
}
/** The layer the actor may manage a link for; system layers never have one. */
async function requireManagedLayer(actor: Actor | null, idOrSlug: string) {
  writable();
  const a = requireActor(actor);
  const found = await getLayer(idOrSlug, a);
  if (!found)
    throw new AppError(404, "NOT_FOUND", "This layer is unavailable.");
  if (!found.access.manage || found.layer.ownerKind === "system")
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the layer owner can manage the view-only link.",
    );
  return { a, layer: found.layer };
}

export async function getShareLinkStatus(
  actor: Actor | null,
  idOrSlug: string,
) {
  const { layer } = await requireManagedLayer(actor, idOrSlug);
  const result = await pool.query<{ created_at: Date }>(
    "SELECT created_at FROM layer_share_link WHERE layer_id=$1 AND revoked_at IS NULL",
    [layer.id],
  );
  const row = result.rows[0];
  return {
    active: !!row,
    createdAt: row ? row.created_at.toISOString() : null,
  };
}

/** Replaces any active link. The raw token is returned here and never again. */
export async function createShareLink(actor: Actor | null, idOrSlug: string) {
  const { a, layer } = await requireManagedLayer(actor, idOrSlug);
  const token = generateOpaqueToken();
  const tx: PoolClient = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT id FROM layer WHERE id=$1 FOR UPDATE", [layer.id]);
    await tx.query(
      "UPDATE layer_share_link SET revoked_at=now(),revoked_by=$2 WHERE layer_id=$1 AND revoked_at IS NULL",
      [layer.id, a.id],
    );
    const inserted = await tx.query<{ created_at: Date }>(
      "INSERT INTO layer_share_link(layer_id,token_hash,created_by) VALUES($1,$2,$3) RETURNING created_at",
      [layer.id, hashToken(token), a.id],
    );
    await tx.query(
      "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,$2,$3)",
      [
        a.id,
        "layer_share_link_created",
        JSON.stringify({ owner: layer.ownerKind, audience: layer.audience }),
      ],
    );
    await tx.query("COMMIT");
    return {
      url: shareUrl(token),
      createdAt: inserted.rows[0].created_at.toISOString(),
    };
  } catch (e) {
    await tx.query("ROLLBACK").catch(() => {});
    if ((e as { code?: string }).code === "23505")
      throw new AppError(
        409,
        "SHARE_LINK_CONFLICT",
        "The link was changed at the same time. Try again.",
      );
    throw e;
  } finally {
    tx.release();
  }
}

export async function revokeShareLink(actor: Actor | null, idOrSlug: string) {
  const { a, layer } = await requireManagedLayer(actor, idOrSlug);
  const result = await pool.query(
    "UPDATE layer_share_link SET revoked_at=now(),revoked_by=$2 WHERE layer_id=$1 AND revoked_at IS NULL",
    [layer.id, a.id],
  );
  return { revoked: (result.rowCount ?? 0) > 0 };
}

/* ---------- Public, token-authorized view ---------- */

export type SharedPlace = {
  id: string;
  name: string;
  nameChinese: string;
  /** Empty for member-dropped (approximate) pins. */
  address: string;
  googleMapsUrl: string | null;
  events: { title: string; titleChinese: string; startTime: string }[];
};
export type SharedLayerView = {
  title: string;
  titleChinese: string;
  description: string;
  descriptionChinese: string;
  ownerKind: string;
  ownerName: string;
  cityName: string;
  citySlug: string;
  timezone: string;
  /** Used only to link a signed-in viewer who already has access. */
  layerId: string;
  slug: string;
  places: SharedPlace[];
};

const maxSharedPlaces = 200;
function mapsUrl(placeId: string, name: string) {
  const params = new URLSearchParams({
    api: "1",
    query: name || placeId,
    query_place_id: placeId,
  });
  return `https://www.google.com/maps/search/?${params}`;
}

/**
 * Resolve a raw token to the layer's public-safe projection, or null for any
 * dead link. Deliberately bypasses viewer access: the verified token is the
 * authorization. Reviews, notes, members, editors and the creator's identity
 * never leave this function.
 */
export async function loadSharedLayer(
  token: unknown,
): Promise<SharedLayerView | null> {
  if (!isShareTokenShape(token)) return null;
  const link = await pool.query<{
    layer_id: string;
    created_by: string | null;
  }>(
    "SELECT layer_id,created_by FROM layer_share_link WHERE token_hash=$1 AND revoked_at IS NULL",
    [hashToken(token)],
  );
  const row = link.rows[0];
  if (!row || !row.created_by) return null;
  // The creator's current standing decides: demotion or removal kills the link.
  const found = await getLayer(row.layer_id, {
    id: row.created_by,
    role: "USER",
  });
  if (
    !found ||
    !shareLinkLive({
      lifecycle: found.layer.lifecycle,
      reviewStatus: found.layer.reviewStatus,
      ownerKind: found.layer.ownerKind,
      createdBy: row.created_by,
      creatorCanManage: found.access.manage,
    })
  )
    return null;
  const layer = found.layer;
  return {
    title: layer.title,
    titleChinese: layer.titleChinese,
    description: layer.description,
    descriptionChinese: layer.descriptionChinese,
    ownerKind: layer.ownerKind,
    ownerName: layer.ownerName,
    cityName: layer.cityName,
    citySlug: layer.citySlug,
    timezone: layer.timezone,
    layerId: layer.id,
    slug: layer.slug,
    places: await loadSharedPlaces(layer),
  };
}

type PlaceRow = {
  id: string;
  kind: "place" | "subject" | "custom" | "event";
  p_name: string | null;
  p_zh: string | null;
  p_address: string | null;
  link_name: string | null;
  display_name: string | null;
  provider_place_id: string | null;
  cp_name: string | null;
  cp_zh: string | null;
  cp_address: string | null;
  location_status: string | null;
  ev_name: string | null;
  ev_zh: string | null;
  ev_start: Date | null;
};

/**
 * Visible rows only: approved catalog places and events, active subjects and
 * custom places. No notes, websites, coordinates or per-member fields are
 * selected, and a member-dropped pin exposes its name only.
 */
async function loadSharedPlaces(layer: LayerRecord): Promise<SharedPlace[]> {
  const rows = await pool.query<PlaceRow>(
    `SELECT i.id,
       CASE WHEN i.place_id IS NOT NULL THEN 'place'
            WHEN i.subject_id IS NOT NULL THEN 'subject'
            WHEN i.custom_place_id IS NOT NULL THEN 'custom'
            ELSE 'event' END AS kind,
       COALESCE(p.name,sp.name) AS p_name,
       COALESCE(p.name_chinese,sp.name_chinese) AS p_zh,
       COALESCE(p.address,sp.address) AS p_address,
       i.link_name,
       ref.display_name,
       ref.provider_place_id,
       cp.name AS cp_name,cp.name_chinese AS cp_zh,cp.address AS cp_address,cp.location_status,
       ev.name AS ev_name,ev.name_chinese AS ev_zh,ev.start_time AS ev_start
     FROM layer_item i
     LEFT JOIN place p ON p.id=i.place_id AND p.status='approved'
     LEFT JOIN place_subject s ON s.id=i.subject_id AND s.status='active'
     LEFT JOIN place sp ON sp.id=s.catalog_place_id AND sp.status='approved'
     LEFT JOIN LATERAL (SELECT r.display_name,r.provider_place_id FROM place_provider_reference r WHERE r.subject_id=s.id AND r.state='current' LIMIT 1) ref ON true
     LEFT JOIN custom_place cp ON cp.id=i.custom_place_id AND cp.status='active'
     LEFT JOIN event ev ON ev.id=i.event_id AND ev.status='approved'
     WHERE i.layer_id=$1
       AND (i.valid_from IS NULL OR i.valid_from<=now())
       AND (i.valid_until IS NULL OR i.valid_until>now())
       AND (
         (i.place_id IS NOT NULL AND p.id IS NOT NULL)
         OR (i.subject_id IS NOT NULL AND s.id IS NOT NULL AND (s.catalog_place_id IS NULL OR sp.id IS NOT NULL))
         OR (i.custom_place_id IS NOT NULL AND cp.id IS NOT NULL)
         OR (i.event_id IS NOT NULL AND ev.id IS NOT NULL)
       )
     ORDER BY i.position,i.created_at,i.id
     LIMIT ${maxSharedPlaces}`,
    [layer.id],
  );
  const events = rows.rows.length
    ? await pool.query<{
        layer_item_id: string;
        title: string;
        title_chinese: string;
        start_time: Date;
      }>(
        `SELECT layer_item_id,title,title_chinese,start_time FROM layer_item_event
         WHERE layer_item_id=ANY($1::uuid[]) AND status='active' AND end_time>now()
         ORDER BY start_time`,
        [rows.rows.map((r) => r.id)],
      )
    : { rows: [] };
  const byItem = new Map<string, SharedPlace["events"]>();
  for (const e of events.rows) {
    const list = byItem.get(e.layer_item_id) ?? [];
    if (list.length < 10)
      list.push({
        title: e.title,
        titleChinese: e.title_chinese,
        startTime: e.start_time.toISOString(),
      });
    byItem.set(e.layer_item_id, list);
  }
  const places: SharedPlace[] = [];
  for (const r of rows.rows) {
    let name = "";
    let nameChinese = "";
    let address = "";
    let googleMapsUrl: string | null = null;
    if (r.kind === "custom") {
      name = r.cp_name ?? "";
      nameChinese = r.cp_zh ?? "";
      // Member-dropped pins are approximate: the name alone is shown.
      address = r.location_status === "approximate" ? "" : (r.cp_address ?? "");
    } else if (r.kind === "event") {
      name = r.ev_name ?? "";
      nameChinese = r.ev_zh ?? "";
      if (r.ev_start)
        byItem.set(r.id, [
          {
            title: name,
            titleChinese: nameChinese,
            startTime: r.ev_start.toISOString(),
          },
          ...(byItem.get(r.id) ?? []),
        ]);
    } else if (r.kind === "subject") {
      name = r.p_name ?? r.link_name ?? r.display_name ?? "";
      nameChinese = r.p_zh ?? "";
      address = r.p_address ?? "";
      if (r.provider_place_id)
        googleMapsUrl = mapsUrl(r.provider_place_id, name);
    } else {
      name = r.p_name ?? "";
      nameChinese = r.p_zh ?? "";
      address = r.p_address ?? "";
    }
    if (!name) continue;
    places.push({
      id: r.id,
      name,
      nameChinese,
      address,
      googleMapsUrl,
      events: byItem.get(r.id) ?? [],
    });
  }
  return places;
}

export async function trackSharedView(ownerKind: string, actorId?: string) {
  // Coarse owner kind only: never the token or the layer slug.
  await trackEvent("shared_layer_viewed", { owner: ownerKind }, actorId);
}
