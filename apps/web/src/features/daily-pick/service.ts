import {
  pool,
  generateDailyPick,
  insertDailyPick,
  loadDailyPickCandidate,
  lockDailyPickSlot,
  lockedPublishedPick,
  withdrawDailyPick,
} from "@taiwanhub/database";
import {
  AppError,
  type Actor,
  type DailyPickIneligibility,
  addDays,
  dailyPickIneligibility,
  dailyPickScheduleInput,
  dailyPickSelectionVersion,
  dailyPickWithdrawInput,
  localDate,
  requireModerator,
} from "@taiwanhub/shared";
import { z } from "zod";
type City = { id: string; slug: string; name: string; timezone: string };
async function cityBySlug(slug: string): Promise<City> {
  const result = await pool.query<City>(
    "SELECT id,slug,name,timezone FROM city WHERE slug=$1",
    [slug],
  );
  if (!result.rows[0])
    throw new AppError(404, "NOT_FOUND", "This city is unavailable.");
  return result.rows[0];
}
const ineligibleMessages: Record<DailyPickIneligibility, string> = {
  not_public: "Only approved, publicly visible places can be a Daily Pick.",
  demo: "Demo places cannot be a Daily Pick.",
  other_city: "This place is in another city.",
  no_description:
    "This place needs a fuller approved description before it can be featured.",
  no_source: "This place needs source attribution before it can be featured.",
  no_location: "This place needs an address and map location to be featured.",
};
async function audit(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
  actorId: string,
  entityId: string,
  action: string,
  reason: string,
) {
  await client.query(
    "INSERT INTO moderation_action(actor_id,entity_type,entity_id,action,reason) VALUES($1,'daily_picks',$2,$3,$4)",
    [actorId, entityId, action, reason],
  );
}
/**
 * Schedule an editorial pick for today or a future date, or replace the
 * published one. Replacement is revision-checked through expectedPickId, the
 * previous row is withdrawn (kept for audit) and both steps are recorded.
 */
export async function scheduleDailyPick(actor: Actor | null, body: unknown) {
  const a = requireModerator(actor);
  const input = dailyPickScheduleInput.parse(body);
  const city = await cityBySlug(input.city);
  const today = localDate(new Date(), city.timezone);
  if (input.date < today)
    throw new AppError(
      400,
      "PAST_DATE",
      "Past picks are history and cannot be rescheduled.",
    );
  if (input.date > addDays(today, 90))
    throw new AppError(400, "TOO_FAR", "Schedule picks at most 90 days ahead.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockDailyPickSlot(client, city.id, input.date);
    const place = await loadDailyPickCandidate(client, input.placeId);
    if (!place) throw new AppError(404, "NOT_FOUND", "Place not found.");
    const ineligible = dailyPickIneligibility(place, city.id);
    if (ineligible)
      throw new AppError(400, "INELIGIBLE", ineligibleMessages[ineligible]);
    const existing = await lockedPublishedPick(client, city.id, input.date);
    if ((existing?.id ?? null) !== input.expectedPickId)
      throw new AppError(
        409,
        "PICK_CHANGED",
        "This date's pick changed. Reload and try again.",
      );
    if (existing) {
      await withdrawDailyPick(client, existing.id, input.reason, a.id);
      await audit(client, a.id, existing.id, "withdrawn", input.reason);
    }
    const id = await insertDailyPick(client, {
      cityId: city.id,
      date: input.date,
      place,
      selectionKind: "editorial",
      reasons: [
        { code: "editorial", note: input.note, noteChinese: input.noteChinese },
      ],
      evidence: {
        selectionVersion: dailyPickSelectionVersion,
        date: input.date,
        editorial: true,
      },
      replacesId: existing?.id ?? null,
      createdBy: a.id,
    });
    if (!id)
      throw new AppError(
        409,
        "PICK_CHANGED",
        "This date's pick changed. Reload and try again.",
      );
    await audit(
      client,
      a.id,
      id,
      existing ? "replaced" : "scheduled",
      input.reason,
    );
    await client.query("COMMIT");
    return { id, replaced: existing?.id ?? null };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
/** Withdraw a published pick without a replacement; the public card then says so honestly. */
export async function withdrawPick(
  actor: Actor | null,
  id: string,
  body: unknown,
) {
  const a = requireModerator(actor);
  const pickId = z.uuid().parse(id);
  const { reason } = dailyPickWithdrawInput.parse(body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      city_id: string;
      date: string;
      status: string;
    }>(
      "SELECT city_id,pick_date::text AS date,status FROM daily_pick WHERE id=$1",
      [pickId],
    );
    const row = found.rows[0];
    if (!row) throw new AppError(404, "NOT_FOUND", "Pick not found.");
    await lockDailyPickSlot(client, row.city_id, row.date);
    const current = await lockedPublishedPick(client, row.city_id, row.date);
    if (current?.id !== pickId)
      throw new AppError(
        409,
        "PICK_CHANGED",
        "This pick is no longer published. Reload and try again.",
      );
    await withdrawDailyPick(client, pickId, reason, a.id);
    await audit(client, a.id, pickId, "withdrawn", reason);
    await client.query("COMMIT");
    return { id: pickId, status: "withdrawn" as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
/**
 * Run the idempotent job for one city's local today; the same code the
 * scheduler runs. The withdrawal, the new pick and their audit records commit
 * together or not at all.
 */
export async function generateTodayPick(actor: Actor | null, body: unknown) {
  const a = requireModerator(actor);
  const { city: slug } = z
    .object({ city: z.string().regex(/^[a-z0-9-]{1,80}$/) })
    .parse(body);
  const city = await cityBySlug(slug);
  return generateDailyPick(city, localDate(new Date(), city.timezone), {
    actorId: a.id,
    onChange: async (client, result) => {
      if (result.withdrawnId)
        await audit(
          client,
          a.id,
          result.withdrawnId,
          "withdrawn",
          "The place is no longer publicly visible (moderator-run selection).",
        );
      if (result.pickId)
        await audit(
          client,
          a.id,
          result.pickId,
          result.withdrawnId ? "replaced" : "generated",
          "Automatic selection run by a moderator.",
        );
    },
  });
}
export type AdminDailyPick = {
  id: string;
  date: string;
  status: "published" | "withdrawn";
  selectionKind: "automatic" | "editorial";
  placeId: string;
  placeName: string;
  placeVisible: boolean;
  reasonText: string;
  createdByName: string | null;
  withdrawalReason: string | null;
  replacesId: string | null;
};
/** Moderator view: recent and scheduled slots (including withdrawn rows) plus eligible places. */
export async function listAdminDailyPicks(actor: Actor | null, slug: string) {
  requireModerator(actor);
  const city = await cityBySlug(slug);
  const today = localDate(new Date(), city.timezone);
  const [picks, places] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `SELECT d.id,d.pick_date::text AS date,d.status,d.selection_kind,d.place_id,p.name AS place_name,(p.status='approved' AND NOT p.is_demo AND p.city_id=d.city_id) AS place_visible,d.reason_text,u.name AS created_by_name,d.withdrawal_reason,d.replaces_id
       FROM daily_pick d JOIN place p ON p.id=d.place_id LEFT JOIN "user" u ON u.id=d.created_by
       WHERE d.city_id=$1 AND d.pick_date BETWEEN $2::date AND $3::date ORDER BY d.pick_date DESC, d.created_at DESC LIMIT 200`,
      [city.id, addDays(today, -14), addDays(today, 90)],
    ),
    pool.query<{ id: string; name: string; category: string }>(
      `SELECT id,name,category FROM place WHERE city_id=$1 AND status='approved' AND NOT is_demo AND char_length(btrim(description))>=40 AND btrim(source)<>'' AND btrim(address)<>'' ORDER BY name LIMIT 500`,
      [city.id],
    ),
  ]);
  return {
    city,
    today,
    picks: picks.rows.map((r): AdminDailyPick => ({
      id: String(r.id),
      date: String(r.date),
      status: r.status as AdminDailyPick["status"],
      selectionKind: r.selection_kind as AdminDailyPick["selectionKind"],
      placeId: String(r.place_id),
      placeName: String(r.place_name),
      placeVisible: Boolean(r.place_visible),
      reasonText: String(r.reason_text ?? ""),
      createdByName: (r.created_by_name as string | null) ?? null,
      withdrawalReason: (r.withdrawal_reason as string | null) ?? null,
      replacesId: (r.replaces_id as string | null) ?? null,
    })),
    places: places.rows,
  };
}
