import { createHash } from "node:crypto";
import { pool } from "@taiwanhub/database";
import {
  AppError,
  layerInput,
  requireActor,
  type Actor,
} from "@taiwanhub/shared";
import { importRequest } from "@taiwanhub/shared/map-import";
import { flags } from "@/lib/config";
import {
  getMemberships,
  requireEditableLayer,
} from "@/features/layers/repository";
import {
  attachLayerItem,
  insertLayer,
  slugify,
  notProjected,
} from "@/features/layers/service";
import { maxCustomPlacesPerScope } from "@/features/custom-places/service";
import { resolverDeps } from "@/features/google-links/deps";
import { myMapsUrl } from "./download";
import { matchPoints } from "./match";

export function importActor(actor: Actor | null) {
  if (!flags.layerWrites || !flags.layerCustomPlaces)
    throw new AppError(404, "DISABLED", "Map imports are unavailable.");
  return requireActor(actor);
}
export type ImportResult = {
  collectionId: string | null;
  layers: { id: string; slug: string; title: string }[];
  added: number;
  reused: number;
  skipped: number;
  /** Markers linked to a Google place (absent on receipts from before matching). */
  matched?: number;
};
/** Markers a member may match against Google per day; bounds the lookups behind imports. */
export const matchBudget = { markers: 2000, hours: 24 };
/**
 * Google place IDs for the selected markers, keyed by marker id. Matching is
 * best effort: without a configured key, over the daily budget, or on any
 * provider failure, markers import as plain custom places, as before.
 */
async function importMatches(
  actor: Actor,
  points: { id: string; name: string; latitude: number; longitude: number }[],
) {
  if (!points.length) return new Map<string, string>();
  let deps;
  try {
    deps = resolverDeps();
  } catch {
    return new Map<string, string>();
  }
  const spent = await pool.query<{ count: number }>(
    `INSERT INTO rate_limit(key,count,expires_at) VALUES($1,$2::int,now()+make_interval(hours=>$3::int))
     ON CONFLICT(key) DO UPDATE SET
       count=CASE WHEN rate_limit.expires_at<now() THEN $2::int ELSE rate_limit.count+$2::int END,
       expires_at=CASE WHEN rate_limit.expires_at<now() THEN now()+make_interval(hours=>$3::int) ELSE rate_limit.expires_at END
     RETURNING count`,
    [`map-import-match:${actor.id}`, points.length, matchBudget.hours],
  );
  if (spent.rows[0].count > matchBudget.markers)
    return new Map<string, string>();
  return matchPoints(points, deps);
}
/** Advisory preview; the transaction repeats all authorization and dedupe checks. */
export async function reviewMapImport(actor: Actor | null, body: unknown) {
  const a = importActor(actor);
  const input = importRequest.parse(body);
  const existing =
    input.mode === "existing"
      ? await requireEditableLayer(input.layerId!, a)
      : null;
  if (existing) {
    notProjected(existing);
    if (existing.layer.audience === "public")
      throw new AppError(
        400,
        "PRIVATE_REQUIRED",
        "Import into a private or group layer.",
      );
    if (existing.layer.revision !== input.revision)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "This layer changed. Reload before importing.",
      );
  }
  const groupId = existing
    ? existing.layer.ownerGroupId
    : (input.groupId ?? null);
  const userId = groupId ? null : (existing?.layer.ownerUserId ?? a.id);
  const city = await pool.query<{ id: string }>(
    "SELECT id FROM city WHERE slug=$1",
    [existing?.layer.citySlug ?? input.city],
  );
  if (!city.rows[0])
    throw new AppError(400, "INVALID_CITY", "Choose a supported city.");
  if (groupId) {
    const role = (await getMemberships(a.id)).get(groupId);
    if (!role || role === "viewer")
      throw new AppError(
        403,
        "FORBIDDEN",
        "You need an editor role in this group.",
      );
    const group = await pool.query<{ city_id: string }>(
      'SELECT city_id FROM "group" WHERE id=$1',
      [groupId],
    );
    if (group.rows[0]?.city_id !== city.rows[0].id)
      throw new AppError(
        400,
        "CITY_MISMATCH",
        "The group belongs to a different city.",
      );
  }
  const points = input.document.layers
    .flatMap((l) => l.points)
    .filter((p) => input.selected.includes(p.id));
  const matches = await pool.query<{ id: string }>(
    `SELECT DISTINCT p.id FROM jsonb_to_recordset($1::jsonb) AS p(id text,name text,latitude float8,longitude float8) JOIN custom_place c ON lower(c.name)=lower(p.name) AND c.latitude=p.latitude AND c.longitude=p.longitude WHERE (c.owner_user_id=$2 OR c.owner_group_id=$3) AND c.city_id=$4 AND c.status='active'`,
    [JSON.stringify(points), userId, groupId, city.rows[0].id],
  );
  const reused = new Set(matches.rows.map((p) => p.id));
  const seen = new Set<string>();
  let duplicates = 0;
  for (const p of points) {
    const key = JSON.stringify([p.name.toLowerCase(), p.latitude, p.longitude]);
    if (reused.has(p.id) || seen.has(key)) duplicates++;
    seen.add(key);
  }
  return {
    markers: points.length,
    newPlaces: points.length - duplicates,
    reused: duplicates,
  };
}
export async function commitMapImport(
  actor: Actor | null,
  body: unknown,
): Promise<ImportResult> {
  const a = importActor(actor);
  const input = importRequest.parse(body);
  const sourceUrl = input.document.sourceUrl
    ? myMapsUrl(input.document.sourceUrl)
    : "";
  const digest = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  // Provider lookups run before the transaction; a replayed request skips them.
  const replay = await pool.query(
    "SELECT 1 FROM map_import_receipt WHERE user_id=$1 AND request_id=$2",
    [a.id, input.requestId],
  );
  const chosen = new Set(input.selected);
  const matches = replay.rows[0]
    ? new Map<string, string>()
    : await importMatches(
        a,
        input.document.layers
          .flatMap((l) => l.points)
          .filter((p) => chosen.has(p.id)),
      );
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `map_import:${a.id}:${input.requestId}`,
    ]);
    const receipt = await tx.query<{ digest: string; result: ImportResult }>(
      "SELECT digest,result FROM map_import_receipt WHERE user_id=$1 AND request_id=$2",
      [a.id, input.requestId],
    );
    if (receipt.rows[0]) {
      if (receipt.rows[0].digest !== digest)
        throw new AppError(
          409,
          "REQUEST_CONFLICT",
          "This request was already used for another import.",
        );
      for (const l of receipt.rows[0].result.layers)
        await requireEditableLayer(l.id, a);
      await tx.query("COMMIT");
      return receipt.rows[0].result;
    }
    const existing =
      input.mode === "existing"
        ? await requireEditableLayer(input.layerId!, a)
        : null;
    const groupId = existing
      ? existing.layer.ownerGroupId
      : (input.groupId ?? null);
    const userId = groupId ? null : (existing?.layer.ownerUserId ?? a.id);
    // Match custom-place creation's lock order: owner scope, then layer.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `custom_place:${userId ?? groupId}`,
    ]);
    if (groupId) {
      const membership = await tx.query<{ role: string }>(
        "SELECT role FROM group_member WHERE group_id=$1 AND user_id=$2 FOR SHARE",
        [groupId, a.id],
      );
      if (!membership.rows[0] || membership.rows[0].role === "viewer")
        throw new AppError(
          403,
          "FORBIDDEN",
          "You need an editor role in this group.",
        );
    }
    if (existing) {
      notProjected(existing);
      const locked = await tx.query<{ revision: number; audience: string }>(
        "SELECT revision,audience FROM layer WHERE id=$1 FOR UPDATE",
        [existing.layer.id],
      );
      if (locked.rows[0]?.revision !== input.revision)
        throw new AppError(
          409,
          "VERSION_CONFLICT",
          "This layer changed. Reload before importing.",
        );
      if (locked.rows[0].audience === "public")
        throw new AppError(
          400,
          "PRIVATE_REQUIRED",
          "Import into a private or group layer.",
        );
    }
    const selected = new Set(input.selected);
    const folders = input.document.layers
      .map((l) => ({
        ...l,
        points: l.points.filter((p) => selected.has(p.id)),
      }))
      .filter((l) => l.points.length);
    const result: ImportResult = {
      collectionId: null,
      layers: [],
      added: 0,
      reused: 0,
      skipped: input.document.skipped,
      matched: 0,
    };
    const targets =
      input.mode === "collection"
        ? folders
        : [{ name: input.title, points: folders.flatMap((l) => l.points) }];
    const count = await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM custom_place WHERE (owner_user_id=$1 OR owner_group_id=$2) AND status<>'deleted'",
      [userId, groupId],
    );
    let placeCount = count.rows[0].count;
    for (const folder of targets) {
      const layer =
        existing?.layer ??
        (await insertLayer(
          tx,
          a,
          layerInput.parse({
            title: folder.name,
            city: input.city,
            audience: groupId ? "group" : "private",
            groupId: groupId ?? undefined,
            description: sourceUrl ? `Imported from ${sourceUrl}` : "",
          }),
        ));
      if (!existing)
        await tx.query("UPDATE layer SET lifecycle='active' WHERE id=$1", [
          layer.id,
        ]);
      const meta = await tx.query<{ id: string; slug: string; title: string }>(
        "SELECT id,slug,title FROM layer WHERE id=$1",
        [layer.id],
      );
      result.layers.push(meta.rows[0]);
      for (const p of folder.points) {
        const match = await tx.query<{ id: string }>(
          `SELECT id FROM custom_place WHERE (owner_user_id=$1 OR owner_group_id=$2) AND city_id=$3 AND status='active' AND lower(name)=lower($4) AND latitude=$5 AND longitude=$6 ORDER BY created_at LIMIT 1`,
          [userId, groupId, layer.cityId, p.name, p.latitude, p.longitude],
        );
        const googlePlaceId = matches.get(p.id) ?? null;
        if (googlePlaceId) result.matched!++;
        let placeId = match.rows[0]?.id;
        if (placeId) {
          result.reused++;
          // Importing again links an earlier, unmatched copy of this marker.
          if (googlePlaceId)
            await tx.query(
              "UPDATE custom_place SET google_place_id=$2, updated_at=now() WHERE id=$1 AND google_place_id IS NULL",
              [placeId, googlePlaceId],
            );
        } else {
          if (++placeCount > maxCustomPlacesPerScope)
            throw new AppError(
              429,
              "LIMIT_REACHED",
              "This import would exceed the 1,000 custom-place limit. Nothing was saved.",
            );
          const row = await tx.query<{ id: string }>(
            `INSERT INTO custom_place(owner_user_id,owner_group_id,city_id,name,address,location_status,latitude,longitude,location,note,created_by,google_place_id) VALUES($1,$2,$3,$4,$5,'approximate',$6::float8,$7::float8,ST_SetSRID(ST_MakePoint($7::float8,$6::float8),4326),$8,$9,$10) RETURNING id`,
            [
              userId,
              groupId,
              layer.cityId,
              p.name,
              p.address,
              p.latitude,
              p.longitude,
              p.description,
              a.id,
              googlePlaceId,
            ],
          );
          placeId = row.rows[0].id;
        }
        const added = await attachLayerItem(
          tx,
          a.id,
          { layer },
          { column: "custom_place_id", id: placeId, external: true },
          sourceUrl ? `Source: ${sourceUrl}` : "Imported from KML/KMZ",
        );
        if (added) result.added++;
        else result.skipped++;
      }
      await tx.query("UPDATE layer SET revision=revision+1 WHERE id=$1", [
        layer.id,
      ]);
    }
    if (input.mode === "collection") {
      const collectionId = crypto.randomUUID();
      await tx.query(
        "INSERT INTO layer_collection(id,slug,title,city_id,owner_user_id,owner_group_id,audience,source_url,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
        [
          collectionId,
          slugify(input.title, collectionId),
          input.title,
          (
            await tx.query<{ id: string }>(
              "SELECT id FROM city WHERE slug=$1",
              [input.city],
            )
          ).rows[0].id,
          userId,
          groupId,
          groupId ? "group" : "private",
          sourceUrl,
          a.id,
        ],
      );
      result.collectionId = collectionId;
      for (const [position, layer] of result.layers.entries())
        await tx.query(
          "INSERT INTO layer_collection_member(collection_id,layer_id,position) VALUES($1,$2,$3)",
          [result.collectionId, layer.id, position],
        );
    }
    await tx.query(
      "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,'map_imported',$2)",
      [
        a.id,
        JSON.stringify({ layers: result.layers.length, added: result.added }),
      ],
    );
    await tx.query(
      "INSERT INTO map_import_receipt(user_id,request_id,digest,result) VALUES($1,$2,$3,$4)",
      [a.id, input.requestId, digest, JSON.stringify(result)],
    );
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
