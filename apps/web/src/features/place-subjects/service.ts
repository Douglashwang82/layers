import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  canonicalSubjectKey,
  placeSubjectResolveInput,
  placeSubjectSaveInput,
  requireActor,
  type Actor,
} from "@taiwanhub/shared";
import { flags } from "@/lib/config";
import {
  findSubjectByCatalogPlace,
  findSubjectById,
  findSubjectByProvider,
  getVisibleSubject,
  isBlocked,
  type SubjectRow,
} from "./repository";
import { grantSecret, signSelectionGrant, verifySelectionGrant } from "./grant";
export async function transaction<T>(fn: (tx: PoolClient) => Promise<T>) {
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
async function record(
  tx: PoolClient,
  userId: string,
  name: string,
  properties: Record<string, string | number | boolean>,
) {
  await tx.query(
    "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,$2,$3)",
    [userId, name, JSON.stringify(properties)],
  );
}
function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === "23505";
}
class LostRace extends Error {}
const unavailable = () =>
  new AppError(404, "NOT_FOUND", "This place is unavailable.");
function resolved(row: SubjectRow, actor: Actor) {
  return {
    subjectId: row.id,
    canonicalKey: canonicalSubjectKey({
      id: row.id,
      catalogPlaceId: row.catalog_place_id,
    }),
    cityReviewStatus: row.city_review_status,
    selectionGrant: signSelectionGrant(
      { actorId: actor.id, subjectId: row.id },
      grantSecret(),
    ),
  };
}
/** Lazily wrap an approved catalog place. Concurrent callers converge on the unique catalog FK. */
async function resolveCatalogPlace(placeId: string) {
  const place = await pool.query<{ city_id: string }>(
    "SELECT city_id FROM place WHERE id=$1 AND status='approved'",
    [placeId],
  );
  if (!place.rows[0]) throw unavailable();
  // A linked catalog place supplies its server-owned city; no moderator review is needed.
  await pool.query(
    `INSERT INTO place_subject(catalog_place_id,city_id,city_review_status) VALUES($1,$2,'approved') ON CONFLICT (catalog_place_id) DO NOTHING`,
    [placeId, place.rows[0].city_id],
  );
  return (await findSubjectByCatalogPlace(pool, placeId))!;
}
/**
 * Create the subject and its provider reference together. If another request
 * wins the unique (provider, provider_place_id) race, this transaction rolls
 * back entirely — no orphan subject — and the winner is returned.
 */
async function resolveProviderPlace(providerPlaceId: string) {
  const existing = await findSubjectByProvider(pool, "google", providerPlaceId);
  if (existing) return existing;
  try {
    const subjectId = await transaction(async (tx) => {
      const subject = await tx.query<{ id: string }>(
        "INSERT INTO place_subject DEFAULT VALUES RETURNING id",
      );
      const id = subject.rows[0].id;
      const reference = await tx.query(
        "INSERT INTO place_provider_reference(subject_id,provider,provider_place_id) VALUES($1,'google',$2) ON CONFLICT (provider,provider_place_id) DO NOTHING",
        [id, providerPlaceId],
      );
      // Losing the race: abandon this subject by rolling the transaction back.
      if (!reference.rowCount) throw new LostRace();
      return id;
    });
    return (await findSubjectById(pool, subjectId))!;
  } catch (error) {
    if (!(error instanceof LostRace) && !isUniqueViolation(error)) throw error;
    const winner = await findSubjectByProvider(pool, "google", providerPlaceId);
    if (!winner) throw error;
    return winner;
  }
}
/**
 * Idempotently resolve a catalog place or provider reference to a local
 * subject. Call only as part of an explicit save/review/add intent: resolving
 * alone publishes nothing and grants nothing beyond the actor's own first
 * save/review of this subject.
 */
export async function resolvePlaceSubject(actor: Actor | null, body: unknown) {
  const a = requireActor(actor);
  const input = placeSubjectResolveInput.parse(body);
  let row: SubjectRow;
  if ("catalogPlaceId" in input)
    row = await resolveCatalogPlace(input.catalogPlaceId);
  else {
    if (!flags.googlePlacesDiscovery)
      throw new AppError(404, "DISABLED", "Business search is unavailable.");
    row = await resolveProviderPlace(input.providerPlaceId);
  }
  // Blocked subjects stay blocked through every alias.
  if (isBlocked(row)) throw unavailable();
  return resolved(row, a);
}
/**
 * The actor may act on their own behalf for a subject they can already see,
 * or one they resolved within the grant window. The grant never extends to
 * anyone else's content, city approval or layer access.
 */
export async function requireActionableSubject(
  tx: PoolClient,
  actor: Actor,
  subjectId: string,
  selectionGrant: string | undefined,
) {
  // Lock the subject first so a concurrent moderation/link change is serialized.
  const locked = await tx.query(
    "SELECT id FROM place_subject WHERE id=$1 FOR UPDATE",
    [subjectId],
  );
  if (!locked.rows[0]) throw unavailable();
  const row = await findSubjectById(tx, subjectId);
  if (!row || isBlocked(row)) throw unavailable();
  if (await getVisibleSubject(subjectId, actor, tx)) return row;
  if (
    selectionGrant &&
    verifySelectionGrant(
      selectionGrant,
      { actorId: actor.id, subjectId },
      grantSecret(),
    )
  )
    return row;
  throw unavailable();
}
/** Idempotent save. Catalog-linked subjects keep using the canonical saved_place row. */
export async function savePlaceSubject(
  actor: Actor | null,
  subjectId: string,
  body: unknown,
) {
  const a = requireActor(actor);
  const input = placeSubjectSaveInput.parse(body ?? {});
  return transaction(async (tx) => {
    const row = await requireActionableSubject(
      tx,
      a,
      subjectId,
      input.selectionGrant,
    );
    if (!row.catalog_place_id && !flags.externalPlaceCollections)
      throw new AppError(404, "DISABLED", "Saving this place is unavailable.");
    const result = row.catalog_place_id
      ? await tx.query(
          "INSERT INTO saved_place(place_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [row.catalog_place_id, a.id],
        )
      : await tx.query(
          "INSERT INTO saved_place_subject(subject_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [row.id, a.id],
        );
    if (result.rowCount)
      await record(tx, a.id, "place_subject_saved", {
        entityId: row.id,
        external: !row.catalog_place_id,
      });
    return {
      saved: true,
      subjectId: row.id,
      canonicalKey: canonicalSubjectKey({
        id: row.id,
        catalogPlaceId: row.catalog_place_id,
      }),
    };
  });
}
/**
 * Unsave is always allowed for the actor's own rows, including a now-hidden
 * reference, and answers identically whether or not anything was saved.
 */
export async function unsavePlaceSubject(
  actor: Actor | null,
  subjectId: string,
) {
  const a = requireActor(actor);
  await transaction(async (tx) => {
    await tx.query(
      "DELETE FROM saved_place_subject WHERE subject_id=$1 AND user_id=$2",
      [subjectId, a.id],
    );
    await tx.query(
      "DELETE FROM saved_place WHERE user_id=$2 AND place_id=(SELECT catalog_place_id FROM place_subject WHERE id=$1)",
      [subjectId, a.id],
    );
  });
  return { saved: false, subjectId };
}
