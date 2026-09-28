import { pool } from "./index";
import {
  localDate,
  isCalendarDate,
  requireModerator,
  type Actor,
} from "../../shared/src";
import {
  loadRestaurantArea,
  prepareRestaurantPickRun,
  publishRestaurantPickRun,
  RunBusy,
  type RestaurantArea,
} from "./daily-pick-restaurant-run";
import type {
  RestaurantCopyAdapter,
  RestaurantDiscoveryAdapter,
  RestaurantQualificationAdapter,
} from "./restaurant-providers";

export type RestaurantAdapters = {
  discovery?: RestaurantDiscoveryAdapter;
  qualification: RestaurantQualificationAdapter;
  copy: RestaurantCopyAdapter;
};

export async function enqueueRestaurantJob(input: {
  areaId: string;
  date: string;
  kind: "prepare" | "publish";
  runId?: string;
  actorId?: string;
  expectedPickId?: string | null;
}) {
  if (!isCalendarDate(input.date)) throw new Error("Invalid date.");
  const result = await pool.query<{ id: string }>(
    `INSERT INTO restaurant_job(area_id,run_date,kind,run_id,requested_by,expected_pick_id)
     SELECT id,$2::date,$3,$4,$5,$6 FROM restaurant_discovery_area WHERE id=$1 AND enabled
     ON CONFLICT (area_id,run_date,kind) WHERE status IN ('queued','running')
     DO NOTHING RETURNING id`,
    [
      input.areaId,
      input.date,
      input.kind,
      input.runId ?? null,
      input.actorId ?? null,
      input.expectedPickId ?? null,
    ],
  );
  if (result.rows[0])
    return { status: "queued" as const, jobId: result.rows[0].id };
  const existing = await pool.query<{
    id: string;
    run_id: string | null;
    expected_pick_id: string | null;
  }>(
    `SELECT id,run_id,expected_pick_id FROM restaurant_job WHERE area_id=$1 AND run_date=$2 AND kind=$3 AND status IN ('queued','running')`,
    [input.areaId, input.date, input.kind],
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.run_id !== (input.runId ?? null) ||
    row.expected_pick_id !== (input.expectedPickId ?? null)
  )
    throw new Error("Area disabled or a different job is already pending.");
  return { status: "queued" as const, jobId: row.id };
}

/** Schedule once per local date; explicit moderator retries remain possible. */
export async function scheduleRestaurantDay(
  area: RestaurantArea,
  date = localDate(new Date(), area.timezone),
) {
  const existing = await pool.query(
    "SELECT id FROM daily_pick_run WHERE area_id=$1 AND run_date=$2 LIMIT 1",
    [area.id, date],
  );
  if (existing.rowCount) return { status: "unchanged" as const };
  return enqueueRestaurantJob({ areaId: area.id, date, kind: "prepare" });
}

/** Claims one job. An expired worker is failed visibly, never automatically republished. */
export async function workRestaurantJob(
  area: RestaurantArea,
  adapters: RestaurantAdapters,
) {
  await pool.query(
    `UPDATE restaurant_job SET status='failed', lease_owner=NULL,lease_expires_at=NULL,result='{"error":"worker_lease_expired"}'::jsonb, updated_at=now()
    WHERE area_id=$1 AND status='running' AND lease_expires_at<now()`,
    [area.id],
  );
  const owner = crypto.randomUUID();
  const claimed = await pool.query<{
    id: string;
    kind: string;
    run_id: string | null;
    run_date: string;
    requested_by: string | null;
    expected_pick_id: string | null;
  }>(
    `UPDATE restaurant_job SET status='running',lease_owner=$2,lease_expires_at=now()+interval '15 minutes',updated_at=now()
      WHERE id=(SELECT id FROM restaurant_job WHERE area_id=$1 AND status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,kind,run_id,run_date::text,requested_by,expected_pick_id`,
    [area.id, owner],
  );
  const job = claimed.rows[0];
  if (!job) return null;
  try {
    const current = await loadRestaurantArea(pool, area.citySlug);
    if (!current?.enabled) throw new Error("Area disabled.");
    if (job.requested_by) {
      const user = await pool.query<Actor>(
        'SELECT id,role FROM "user" WHERE id=$1',
        [job.requested_by],
      );
      requireModerator(user.rows[0] ?? null);
    }
    const result =
      job.kind === "prepare"
        ? await prepareRestaurantPickRun(current, job.run_date, adapters)
        : await publishRestaurantPickRun(
            job.run_id!,
            job.requested_by,
            adapters,
            { expectedPickId: job.expected_pick_id },
          );
    const succeeded = [
      "ready_for_review",
      "empty",
      "created",
      "replaced",
      "unchanged",
    ].includes(result.status);
    await pool.query(
      `UPDATE restaurant_job SET status=$3,result=$4::jsonb,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_owner=$2`,
      [
        job.id,
        owner,
        succeeded ? "succeeded" : "failed",
        JSON.stringify(result),
      ],
    );
    return { jobId: job.id, ...result };
  } catch (error) {
    const code =
      error instanceof RunBusy
        ? "run_awaits_review_or_is_busy"
        : "worker_failed";
    await pool.query(
      `UPDATE restaurant_job SET status='failed',result=$3::jsonb,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_owner=$2`,
      [job.id, owner, JSON.stringify({ error: code })],
    );
    return { jobId: job.id, status: "failed", error: code };
  }
}
