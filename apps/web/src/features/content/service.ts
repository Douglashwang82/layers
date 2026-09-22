import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  contentInput,
  isModerator,
  requireActor,
  type Actor,
} from "@taiwanhub/shared";
import { slugify } from "../layers/service";
import { getContentPost } from "./repository";
import { flags } from "@/lib/config";
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
function enabled() {
  if (!flags.content || !flags.submissions)
    throw new AppError(404, "DISABLED", "Content submissions are unavailable.");
}
/**
 * Content is validated and moderated before public discovery. A linked place
 * or event supplies the public location; a free point is only stored for an
 * exact status; area/city-wide/online statuses never fabricate a pin.
 */
export async function createContent(actor: Actor | null, body: unknown) {
  enabled();
  const a = requireActor(actor);
  const input = contentInput.parse(body);
  const id = await transaction(async (tx) => {
    const city = await tx.query<{ id: string }>(
      "SELECT id FROM city WHERE slug=$1",
      [input.city],
    );
    if (!city.rows[0])
      throw new AppError(400, "INVALID_CITY", "Choose a supported city.");
    for (const [table, ref] of [
      ["place", input.placeId],
      ["event", input.eventId],
    ] as const) {
      if (!ref) continue;
      const linked = await tx.query<{ city_id: string }>(
        `SELECT city_id FROM ${table} WHERE id=$1 AND status='approved'`,
        [ref],
      );
      if (!linked.rows[0])
        throw new AppError(404, "NOT_FOUND", "The linked item is unavailable.");
      if (linked.rows[0].city_id !== city.rows[0].id)
        throw new AppError(
          400,
          "CITY_MISMATCH",
          "The linked item is in a different city.",
        );
    }
    const linked = !!(input.placeId || input.eventId);
    const status = linked ? "exact" : input.locationStatus;
    const point =
      status === "exact" &&
      !linked &&
      input.latitude != null &&
      input.longitude != null;
    const contentId = crypto.randomUUID();
    await tx.query(
      `INSERT INTO content_post(id,slug,author_id,city_id,title,title_chinese,body,image,source_url,place_id,event_id,location_status,neighborhood,latitude,longitude,valid_from,valid_until,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        contentId,
        slugify(input.title, contentId),
        a.id,
        city.rows[0].id,
        input.title,
        input.titleChinese,
        input.body,
        input.image ?? null,
        input.sourceUrl || null,
        input.placeId ?? null,
        input.eventId ?? null,
        status,
        input.neighborhood,
        point ? input.latitude : null,
        point ? input.longitude : null,
        input.validFrom ?? null,
        input.validUntil ?? null,
        isModerator(a.role) ? "approved" : "pending",
      ],
    );
    if (!isModerator(a.role))
      await tx.query(
        "INSERT INTO submission(user_id,entity_type,entity_id) VALUES($1,'content',$2)",
        [a.id, contentId],
      );
    await tx.query(
      "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,'content_submitted',$2)",
      [a.id, JSON.stringify({ contentId, locationStatus: status })],
    );
    return contentId;
  });
  return getContentPost(id, a);
}
/** Content saves have their own persistence path, mirroring the catalog Save semantics. */
export async function saveContent(
  actor: Actor | null,
  id: string,
  active: boolean,
) {
  if (!flags.content)
    throw new AppError(404, "DISABLED", "Feature unavailable.");
  const a = requireActor(actor);
  const post = await getContentPost(id, a);
  if (post.status !== "approved")
    throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
  if (active)
    await pool.query(
      "INSERT INTO saved_content(user_id,content_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [a.id, post.id],
    );
  else
    await pool.query(
      "DELETE FROM saved_content WHERE user_id=$1 AND content_id=$2",
      [a.id, post.id],
    );
  return { saved: active };
}
