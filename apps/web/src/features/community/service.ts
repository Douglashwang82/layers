import { pool } from "@taiwanhub/database";
import { type PoolClient } from "pg";
import {
  AppError,
  requireActor,
  requireModerator,
  recommendationInput,
  sightingInput,
  eventInput,
  placeInput,
  moderationInput,
  editInput,
  type Actor,
  type Kind,
} from "@taiwanhub/shared";
import { tables } from "../catalog/repository";
const moderationTables = {
  ...tables,
  notes: "place_note",
  sightings: "product_sighting",
  recommendations: "place_recommendation",
};
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
async function record(
  tx: PoolClient,
  userId: string,
  name: string,
  entityId: string,
) {
  await tx.query(
    "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,$2,$3)",
    [userId, name, JSON.stringify({ entityId })],
  );
}
async function approved(tx: PoolClient, kind: Kind, id: string) {
  const result = await tx.query(
    `SELECT * FROM ${tables[kind]} WHERE id=$1 AND status='approved' FOR UPDATE`,
    [id],
  );
  if (!result.rows[0])
    throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
  return result.rows[0] as Record<string, unknown>;
}
export async function contributionLimit(actor: Actor) {
  const result = await pool.query<{ count: number }>(
    `INSERT INTO rate_limit(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limit.expires_at<now() THEN 1 ELSE rate_limit.count+1 END, expires_at=CASE WHEN rate_limit.expires_at<now() THEN now()+interval '1 minute' ELSE rate_limit.expires_at END RETURNING count`,
    [`contribution:${actor.id}`],
  );
  if (result.rows[0].count > 30)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait a minute before trying again.",
    );
}
export async function recommend(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  const a = requireActor(actor);
  const input = recommendationInput.parse(body);
  return transaction(async (tx) => {
    await approved(tx, "places", id);
    await tx.query(
      `INSERT INTO place_recommendation(place_id,user_id,positive) VALUES($1,$2,$3) ON CONFLICT(user_id,place_id) DO UPDATE SET positive=$3,updated_at=now()`,
      [id, a.id, input.positive],
    );
    if (input.note) {
      const note = await tx.query<{ id: string }>(
        "INSERT INTO place_note(place_id,user_id,body) VALUES($1,$2,$3) RETURNING id",
        [id, a.id, input.note],
      );
      await tx.query(
        "INSERT INTO submission(user_id,entity_type,entity_id) VALUES($1,'notes',$2)",
        [a.id, note.rows[0].id],
      );
    }
    await record(tx, a.id, "place_recommended", id);
    return {
      positive: input.positive,
      noteStatus: input.note ? "pending" : undefined,
    };
  });
}
export async function rsvp(actor: Actor | null, id: string, active: boolean) {
  const a = requireActor(actor);
  return transaction(async (tx) => {
    const e = await approved(tx, "events", id);
    if (!active) {
      await tx.query(
        "DELETE FROM event_rsvp WHERE event_id=$1 AND user_id=$2",
        [id, a.id],
      );
      return { going: false };
    }
    if (new Date(e.end_time as string) <= new Date())
      throw new AppError(409, "EVENT_ENDED", "This event has ended.");
    const existing = await tx.query(
      "SELECT 1 FROM event_rsvp WHERE event_id=$1 AND user_id=$2",
      [id, a.id],
    );
    if (!existing.rowCount) {
      const count = await tx.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM event_rsvp WHERE event_id=$1",
        [id],
      );
      if (e.capacity !== null && count.rows[0].count >= Number(e.capacity))
        throw new AppError(409, "EVENT_FULL", "This event is full.");
      await tx.query("INSERT INTO event_rsvp(event_id,user_id) VALUES($1,$2)", [
        id,
        a.id,
      ]);
      await record(tx, a.id, "event_rsvp", id);
    }
    return { going: true };
  });
}
export async function save(
  actor: Actor | null,
  kind: Exclude<Kind, "organizations">,
  id: string,
  active: boolean,
) {
  const a = requireActor(actor);
  return transaction(async (tx) => {
    await approved(tx, kind, id);
    const table = tables[kind];
    if (active) {
      const result = await tx.query(
        `INSERT INTO saved_${table}(${table}_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [id, a.id],
      );
      if (result.rowCount) await record(tx, a.id, `${table}_saved`, id);
    } else
      await tx.query(
        `DELETE FROM saved_${table} WHERE ${table}_id=$1 AND user_id=$2`,
        [id, a.id],
      );
    return { saved: active };
  });
}
export async function follow(actor: Actor | null, id: string, active: boolean) {
  const a = requireActor(actor);
  return transaction(async (tx) => {
    await approved(tx, "organizations", id);
    if (active) {
      const result = await tx.query(
        "INSERT INTO organization_follow(organization_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, a.id],
      );
      if (result.rowCount) await record(tx, a.id, "organization_followed", id);
    } else
      await tx.query(
        "DELETE FROM organization_follow WHERE organization_id=$1 AND user_id=$2",
        [id, a.id],
      );
    return { following: active };
  });
}
export async function createSighting(actor: Actor | null, body: unknown) {
  const a = requireActor(actor);
  const input = sightingInput.parse(body);
  return transaction(async (tx) => {
    await approved(tx, "products", input.productId);
    const place = await approved(tx, "places", input.placeId);
    if (place.category !== "Asian Grocery")
      throw new AppError(400, "INVALID_STORE", "Choose a grocery store.");
    const result = await tx.query<{ id: string }>(
      `INSERT INTO product_sighting(product_id,place_id,user_id,price,image,observed_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        input.productId,
        input.placeId,
        a.id,
        input.price ?? null,
        input.image ?? null,
        input.observedAt,
      ],
    );
    const id = result.rows[0].id;
    await tx.query(
      "INSERT INTO submission(user_id,entity_type,entity_id) VALUES($1,'sightings',$2)",
      [a.id, id],
    );
    await record(tx, a.id, "product_sighting_submitted", id);
    return { id, status: "pending" };
  });
}
export async function submitContent(
  actor: Actor | null,
  kind: "places" | "events",
  body: unknown,
) {
  const a = requireActor(actor);
  const input =
    kind === "places" ? placeInput.parse(body) : eventInput.parse(body);
  return transaction(async (tx) => {
    const city = await tx.query("SELECT id FROM city WHERE id=$1", [
      input.cityId,
    ]);
    if (!city.rowCount)
      throw new AppError(400, "INVALID_CITY", "Choose a supported city.");
    const id = crypto.randomUUID();
    const slug =
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") +
      "-" +
      id.slice(0, 8);
    const cols = [
      "id",
      "slug",
      "name",
      "name_chinese",
      "description",
      "image",
      "category",
      "city_id",
      "neighborhood",
      "address",
      "latitude",
      "longitude",
      "submitted_by",
    ];
    const values: unknown[] = [
      id,
      slug,
      input.name,
      input.nameChinese,
      input.description,
      input.image,
      input.category,
      input.cityId,
      input.neighborhood,
      input.address,
      input.latitude,
      input.longitude,
      a.id,
    ];
    if ("organizerId" in input) {
      const org = await approved(tx, "organizations", input.organizerId);
      if (org.city_id !== input.cityId)
        throw new AppError(
          400,
          "CITY_MISMATCH",
          "Organizer must be in the selected city.",
        );
      cols.push("organizer_id", "venue", "start_time", "end_time", "capacity");
      values.push(
        input.organizerId,
        input.venue,
        input.startTime,
        input.endTime,
        input.capacity ?? null,
      );
    }
    await tx.query(
      `INSERT INTO ${tables[kind]}(${cols.join(",")},location) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")},ST_SetSRID(ST_MakePoint($12,$11),4326))`,
      values,
    );
    await tx.query(
      "INSERT INTO submission(user_id,entity_type,entity_id) VALUES($1,$2,$3)",
      [a.id, kind, id],
    );
    await record(tx, a.id, `${tables[kind]}_submitted`, id);
    return { id, slug, status: "pending" };
  });
}
export async function moderate(actor: Actor | null, body: unknown) {
  const a = requireModerator(actor);
  const input = moderationInput.parse(body);
  if (input.action === "deleted" && a.role !== "ADMIN")
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only administrators can delete content.",
    );
  return transaction(async (tx) => {
    const result = await tx.query(
      `UPDATE ${moderationTables[input.entityType]} SET status=$1,updated_at=now() WHERE id=$2 RETURNING id`,
      [input.action, input.entityId],
    );
    if (!result.rowCount)
      throw new AppError(404, "NOT_FOUND", "Content not found.");
    await tx.query(
      "UPDATE submission SET status=$1,updated_at=now() WHERE entity_id=$2 AND entity_type=$3",
      [input.action, input.entityId, input.entityType],
    );
    await tx.query(
      "INSERT INTO moderation_action(actor_id,entity_type,entity_id,action,reason) VALUES($1,$2,$3,$4,$5)",
      [a.id, input.entityType, input.entityId, input.action, input.reason],
    );
    return { status: input.action };
  });
}
export async function editContent(
  actor: Actor | null,
  kind: Kind,
  id: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  const input = editInput.parse(body);
  return transaction(async (tx) => {
    const current = (
      await tx.query<Record<string, unknown>>(
        `SELECT * FROM ${tables[kind]} WHERE id=$1 FOR UPDATE`,
        [id],
      )
    ).rows[0];
    if (!current) throw new AppError(404, "NOT_FOUND", "Content not found.");
    const allowed = [
      "descriptionChinese",
      "aliases",
      ...(kind === "places" || kind === "events"
        ? ["address", "neighborhood", "latitude", "longitude"]
        : []),
      ...(kind === "places" ? ["website", "phone", "hours"] : []),
      ...(kind === "events"
        ? ["venue", "startTime", "endTime", "capacity"]
        : []),
      ...(kind === "products" ? ["brand", "onlineUrl"] : []),
      ...(kind === "organizations" ? ["website", "instagram", "facebook"] : []),
    ];
    if (kind === "events") {
      const start = new Date(input.startTime ?? String(current.start_time));
      const end = new Date(input.endTime ?? String(current.end_time));
      if (end <= start)
        throw new AppError(400, "INVALID_TIME", "End must be after start.");
      if (input.capacity != null) {
        const count = await tx.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM event_rsvp WHERE event_id=$1",
          [id],
        );
        if (count.rows[0].count > input.capacity)
          throw new AppError(
            409,
            "CAPACITY",
            "Capacity cannot be below current attendance.",
          );
      }
    }
    const extra = Object.entries(input).filter(([key]) =>
      allowed.includes(key),
    );
    if (extra.length) {
      const updates = extra.map(
        ([key], i) =>
          `${key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}=$${i + 2}`,
      );
      await tx.query(
        `UPDATE ${tables[kind]} SET ${updates.join(",")} WHERE id=$1`,
        [id, ...extra.map(([, value]) => value)],
      );
    }
    if (
      (kind === "places" || kind === "events") &&
      (input.latitude !== undefined || input.longitude !== undefined)
    )
      await tx.query(
        `UPDATE ${tables[kind]} SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1`,
        [id],
      );
    const result = await tx.query(
      `UPDATE ${tables[kind]} SET name=$1,name_chinese=$2,description=$3,image=$4,category=$5,updated_at=now() WHERE id=$6 RETURNING id`,
      [
        input.name,
        input.nameChinese,
        input.description,
        input.image,
        input.category,
        id,
      ],
    );
    if (!result.rowCount)
      throw new AppError(404, "NOT_FOUND", "Content not found.");
    await tx.query(
      "INSERT INTO moderation_action(actor_id,entity_type,entity_id,action,reason) VALUES($1,$2,$3,'edit','Edited content fields')",
      [a.id, kind, id],
    );
    return { id };
  });
}
