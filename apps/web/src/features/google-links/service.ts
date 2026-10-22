import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  googleLinksResolveInput,
  googlePlacesImportInput,
  layerFromGoogleInput,
  requireActor,
  type Actor,
} from "@taiwanhub/shared";
import { flags } from "@/lib/config";
import { getLayer, requireEditableLayer } from "@/features/layers/repository";
import {
  attachLayerItem,
  insertLayer,
  notProjected,
  subjectPlacement,
  type PlacementLayer,
} from "@/features/layers/service";
import { resolveProviderPlace } from "@/features/place-subjects/service";
import {
  isBlocked,
  type SubjectRow,
} from "@/features/place-subjects/repository";
import { resolveLinks } from "./resolver";
import { resolverDeps } from "./deps";
export { resolverDeps };
/*
 * Layers from Google Maps links (docs/plans/layer-mvp-google-links-plan.md
 * §2–§3). Resolving publishes nothing; importing stores only Google place IDs
 * (as place subjects) and layer memberships, with the name each pasted link
 * carried kept on its layer item.
 */
/** Pasted links a member may resolve per window; bounds the paid lookups behind them. */
export const linkBudget = { links: 150, minutes: 10 };
function enabled() {
  if (!flags.mapMvp || !flags.layerWrites)
    throw new AppError(
      404,
      "DISABLED",
      "Adding places from Google Maps is unavailable.",
    );
}
async function spendLinkBudget(actor: Actor, count: number) {
  const result = await pool.query<{ count: number }>(
    `INSERT INTO rate_limit(key,count,expires_at) VALUES($1,$2::int,now()+make_interval(mins=>$3::int))
     ON CONFLICT(key) DO UPDATE SET
       count=CASE WHEN rate_limit.expires_at<now() THEN $2::int ELSE rate_limit.count+$2::int END,
       expires_at=CASE WHEN rate_limit.expires_at<now() THEN now()+make_interval(mins=>$3::int) ELSE rate_limit.expires_at END
     RETURNING count`,
    [`google-links:${actor.id}`, count, linkBudget.minutes],
  );
  if (result.rows[0].count > linkBudget.links)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "You've checked a lot of links. Please wait a few minutes and try again.",
    );
}
/** Resolve pasted links to Google place IDs, one result per link in input order. */
export async function resolveGoogleLinks(actor: Actor | null, body: unknown) {
  enabled();
  const a = requireActor(actor);
  const input = googleLinksResolveInput.parse(body);
  const deps = resolverDeps();
  await spendLinkBudget(a, input.links.length);
  return { results: await resolveLinks(input.links, deps) };
}
type Resolved = { providerPlaceId: string; row: SubjectRow | null };
/**
 * Find or create a subject per distinct place ID. Each is idempotent and
 * publishes nothing on its own, so this runs before the write transaction.
 */
async function resolveSubjects(ids: string[]): Promise<Resolved[]> {
  const resolved: Resolved[] = [];
  for (const providerPlaceId of [...new Set(ids)]) {
    const row = await resolveProviderPlace(providerPlaceId);
    resolved.push({ providerPlaceId, row: isBlocked(row) ? null : row });
  }
  return resolved;
}
export type ImportOutcome = {
  added: number;
  skipped: { providerPlaceId: string; reason: string }[];
};
async function attachAll(
  tx: PoolClient,
  actor: Actor,
  layer: PlacementLayer,
  subjects: Resolved[],
  linkNames: Record<string, string> = {},
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { added: 0, skipped: [] };
  for (const { providerPlaceId, row } of subjects) {
    if (!row) {
      outcome.skipped.push({ providerPlaceId, reason: "UNAVAILABLE" });
      continue;
    }
    // Serialize with moderation/link changes, as requireActionableSubject does.
    const locked = await tx.query(
      "SELECT id FROM place_subject WHERE id=$1 AND status='active' FOR SHARE",
      [row.id],
    );
    if (!locked.rows[0]) {
      outcome.skipped.push({ providerPlaceId, reason: "UNAVAILABLE" });
      continue;
    }
    let target;
    try {
      target = await subjectPlacement(tx, layer, row, { anyCity: true });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      outcome.skipped.push({ providerPlaceId, reason: error.code });
      continue;
    }
    if (await attachLayerItem(tx, actor.id, layer, target, ""))
      outcome.added += 1;
    else outcome.skipped.push({ providerPlaceId, reason: "DUPLICATE" });
    // Pasting a place's link again refreshes its name in this layer.
    const name = linkNames[providerPlaceId];
    if (name && target.column === "subject_id")
      await tx.query(
        "UPDATE layer_item SET link_name=$3, updated_at=now() WHERE layer_id=$1 AND subject_id=$2",
        [layer.layer.id, target.id, name],
      );
  }
  if (outcome.added)
    await tx.query(
      "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,'layer_google_places_added',$2)",
      [
        actor.id,
        JSON.stringify({ layerId: layer.layer.id, count: outcome.added }),
      ],
    );
  return outcome;
}
async function transaction<T>(fn: (tx: PoolClient) => Promise<T>) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
}
/** Add resolved Google places to a layer the actor edits. Duplicates collapse. */
export async function importGooglePlaces(
  actor: Actor | null,
  layerId: string,
  body: unknown,
) {
  enabled();
  const a = requireActor(actor);
  const input = googlePlacesImportInput.parse(body);
  const found = await requireEditableLayer(layerId, a);
  notProjected(found);
  const subjects = await resolveSubjects(input.providerPlaceIds);
  return transaction((tx) =>
    attachAll(tx, a, found, subjects, input.linkNames),
  );
}
/**
 * Create a private or group layer and fill it with the resolved places in
 * one transaction: either the layer exists with its places or nothing does.
 * The layer is active immediately, since it was made to be put on the map.
 */
export async function createLayerFromGoogle(
  actor: Actor | null,
  body: unknown,
) {
  enabled();
  const a = requireActor(actor);
  const input = layerFromGoogleInput.parse(body);
  const subjects = await resolveSubjects(input.providerPlaceIds);
  const { id, outcome } = await transaction(async (tx) => {
    const layer = await insertLayer(tx, a, {
      title: input.title,
      titleChinese: input.titleChinese,
      description: input.description,
      descriptionChinese: "",
      city: input.city,
      audience: input.audience,
      groupId: input.groupId,
      schedule: "evergreen",
    });
    await tx.query("UPDATE layer SET lifecycle='active' WHERE id=$1", [
      layer.id,
    ]);
    const outcome = await attachAll(
      tx,
      a,
      {
        layer: { id: layer.id, cityId: layer.cityId, audience: layer.audience },
      },
      subjects,
      input.linkNames,
    );
    return { id: layer.id, outcome };
  });
  return { ...(await getLayer(id, a))!, ...outcome };
}
