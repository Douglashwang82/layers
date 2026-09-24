import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";

const cleanupUserIds: string[] = [];
const cleanupBatchIds: string[] = [];
const cleanupNominationIds: string[] = [];

async function makeUser(email: string) {
  const id = crypto.randomUUID();
  cleanupUserIds.push(id);
  await pool.query(
    'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
    [id, "Membership Schema Test", email, "USER"],
  );
  return id;
}

afterAll(async () => {
  if (cleanupNominationIds.length)
    await pool.query(
      'DELETE FROM "membership_nomination" WHERE id = ANY($1::uuid[])',
      [cleanupNominationIds],
    );
  if (cleanupBatchIds.length)
    await pool.query(
      'DELETE FROM "membership_batch" WHERE id = ANY($1::uuid[])',
      [cleanupBatchIds],
    );
  if (cleanupUserIds.length)
    await pool.query('DELETE FROM "user" WHERE id = ANY($1::uuid[])', [
      cleanupUserIds,
    ]);
  await pool.end();
});

describe("membership schema constraints (S1 acceptance)", () => {
  it("rejects a non-positive batch capacity", async () => {
    await expect(
      pool.query(
        'INSERT INTO "membership_batch"(name, capacity) VALUES ($1, $2)',
        ["Bad batch", 0],
      ),
    ).rejects.toThrow(/membership_batch_capacity_positive/);
  });

  it("allows only one open batch at a time", async () => {
    const adminId = await makeUser(`admin-${crypto.randomUUID()}@example.test`);
    const first = await pool.query(
      'INSERT INTO "membership_batch"(name, capacity, status, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      ["Batch A", 20, "open", adminId],
    );
    cleanupBatchIds.push(first.rows[0].id);

    await expect(
      pool.query(
        'INSERT INTO "membership_batch"(name, capacity, status, created_by) VALUES ($1, $2, $3, $4)',
        ["Batch B", 20, "open", adminId],
      ),
    ).rejects.toThrow(/membership_batch_single_open/);

    const closed = await pool.query(
      'INSERT INTO "membership_batch"(name, capacity, status, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      ["Batch C", 10, "closed", adminId],
    );
    cleanupBatchIds.push(closed.rows[0].id);
  });

  it("requires a nominator unless the nomination is an operator bootstrap", async () => {
    await expect(
      pool.query(
        'INSERT INTO "membership_nomination"(email_normalized, nominator_id, source) VALUES ($1, NULL, $2)',
        ["nominator-required@example.test", "member"],
      ),
    ).rejects.toThrow(/membership_nomination_nominator_required/);

    const nomination = await pool.query(
      'INSERT INTO "membership_nomination"(email_normalized, nominator_id, source) VALUES ($1, NULL, $2) RETURNING id',
      ["bootstrap-ok@example.test", "operator_bootstrap"],
    );
    cleanupNominationIds.push(nomination.rows[0].id);
  });

  it("allows only one active nomination per email at a time", async () => {
    const nominator = await makeUser(
      `nominator-${crypto.randomUUID()}@example.test`,
    );
    const email = `duplicate-${crypto.randomUUID()}@example.test`;
    const first = await pool.query(
      'INSERT INTO "membership_nomination"(email_normalized, nominator_id, source) VALUES ($1, $2, $3) RETURNING id',
      [email, nominator, "member"],
    );
    cleanupNominationIds.push(first.rows[0].id);

    await expect(
      pool.query(
        'INSERT INTO "membership_nomination"(email_normalized, nominator_id, source) VALUES ($1, $2, $3)',
        [email, nominator, "member"],
      ),
    ).rejects.toThrow(/membership_nomination_open_email/);

    await pool.query(
      'UPDATE "membership_nomination" SET status = $1 WHERE id = $2',
      ["rejected", first.rows[0].id],
    );
    const second = await pool.query(
      'INSERT INTO "membership_nomination"(email_normalized, nominator_id, source) VALUES ($1, $2, $3) RETURNING id',
      [email, nominator, "member"],
    );
    cleanupNominationIds.push(second.rows[0].id);
  });

  it("requires an invitation for non-legacy admission sources", async () => {
    const userId = await makeUser(
      `admission-${crypto.randomUUID()}@example.test`,
    );
    await expect(
      pool.query(
        'INSERT INTO "membership_admission"(user_id, source, invitation_id) VALUES ($1, $2, NULL)',
        [userId, "invitation"],
      ),
    ).rejects.toThrow(/membership_admission_invitation_required/);

    await pool.query(
      'INSERT INTO "membership_admission"(user_id, source, invitation_id) VALUES ($1, $2, NULL)',
      [userId, "legacy"],
    );
    await pool.query('DELETE FROM "membership_admission" WHERE user_id = $1', [
      userId,
    ]);
  });
});
