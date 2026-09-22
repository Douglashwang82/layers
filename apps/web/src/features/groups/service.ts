import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import {
  AppError,
  groupInput,
  groupInviteInput,
  groupRoleInput,
  requireActor,
  type Actor,
} from "@taiwanhub/shared";
import { slugify } from "../layers/service";
import { getGroup, getInviteByToken } from "./repository";
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
function writable() {
  if (!flags.layerWrites)
    throw new AppError(404, "DISABLED", "Group editing is unavailable.");
}
async function requireOwner(groupId: string, actor: Actor) {
  const found = await getGroup(groupId, actor);
  if (!found)
    throw new AppError(404, "NOT_FOUND", "This group is unavailable.");
  if (found.role !== "owner")
    throw new AppError(403, "FORBIDDEN", "Only a group owner can do this.");
  return found.group;
}
/** The creator becomes the owner; ownership is never left empty. */
export async function createGroup(actor: Actor | null, body: unknown) {
  writable();
  const a = requireActor(actor);
  const input = groupInput.parse(body);
  const id = await transaction(async (tx) => {
    const city = await tx.query<{ id: string }>(
      "SELECT id FROM city WHERE slug=$1",
      [input.city],
    );
    if (!city.rows[0])
      throw new AppError(400, "INVALID_CITY", "Choose a supported city.");
    const groupId = crypto.randomUUID();
    await tx.query(
      `INSERT INTO "group"(id,slug,name,name_chinese,description,city_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        groupId,
        slugify(input.name, groupId),
        input.name,
        input.nameChinese,
        input.description,
        city.rows[0].id,
        a.id,
      ],
    );
    await tx.query(
      "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'owner')",
      [groupId, a.id],
    );
    await tx.query(
      "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,'group_created',$2)",
      [a.id, JSON.stringify({ groupId })],
    );
    return groupId;
  });
  return (await getGroup(id, a))!;
}
/** Invitations are addressed to an email, expire in 14 days, and can be revoked. */
export async function inviteMember(
  actor: Actor | null,
  groupId: string,
  body: unknown,
) {
  writable();
  const a = requireActor(actor);
  const input = groupInviteInput.parse(body);
  const group = await requireOwner(groupId, a);
  const token =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
  const result = await pool.query<{ id: string; expires_at: Date }>(
    `INSERT INTO group_invite(group_id,email,role,token,expires_at,created_by) VALUES($1,$2,$3,$4,now()+interval '14 days',$5) RETURNING id,expires_at`,
    [group.id, input.email.toLowerCase(), input.role, token, a.id],
  );
  return {
    id: result.rows[0].id,
    token,
    email: input.email.toLowerCase(),
    role: input.role,
    expiresAt: result.rows[0].expires_at.toISOString(),
  };
}
export async function revokeInvite(
  actor: Actor | null,
  groupId: string,
  inviteId: string,
) {
  writable();
  const a = requireActor(actor);
  const group = await requireOwner(groupId, a);
  const result = await pool.query(
    "UPDATE group_invite SET revoked_at=now() WHERE id=$1 AND group_id=$2 AND revoked_at IS NULL AND accepted_at IS NULL",
    [inviteId, group.id],
  );
  return { revoked: (result.rowCount ?? 0) > 0 };
}
/** Acceptance requires the signed-in account whose email the invitation names. */
export async function acceptInvite(actor: Actor | null, token: string) {
  writable();
  const a = requireActor(actor);
  const invite = await getInviteByToken(token);
  if (!invite || !invite.valid)
    throw new AppError(
      404,
      "INVITE_INVALID",
      "This invitation is no longer valid.",
    );
  const user = await pool.query<{ email: string }>(
    'SELECT email FROM "user" WHERE id=$1',
    [a.id],
  );
  if (user.rows[0]?.email.toLowerCase() !== invite.email)
    throw new AppError(
      403,
      "INVITE_MISMATCH",
      "Sign in with the account this invitation was sent to.",
    );
  return transaction(async (tx) => {
    const claimed = await tx.query(
      "UPDATE group_invite SET accepted_at=now() WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
      [invite.id],
    );
    if (!claimed.rowCount)
      throw new AppError(
        404,
        "INVITE_INVALID",
        "This invitation is no longer valid.",
      );
    await tx.query(
      "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT (group_id,user_id) DO NOTHING",
      [invite.groupId, a.id, invite.role],
    );
    await tx.query(
      "INSERT INTO analytics_event(user_id,name,properties) VALUES($1,'group_joined',$2)",
      [a.id, JSON.stringify({ groupId: invite.groupId, role: invite.role })],
    );
    return { groupSlug: invite.groupSlug, role: invite.role };
  });
}
/** Owners manage roles; the last owner cannot be demoted or removed. */
export async function setMemberRole(
  actor: Actor | null,
  groupId: string,
  userId: string,
  body: unknown,
) {
  writable();
  const a = requireActor(actor);
  const input = groupRoleInput.parse(body);
  const group = await requireOwner(groupId, a);
  return transaction(async (tx) => {
    await tx.query('SELECT 1 FROM "group" WHERE id=$1 FOR UPDATE', [group.id]);
    if (input.role !== "owner") {
      const owners = await tx.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM group_member WHERE group_id=$1 AND role='owner' AND user_id<>$2",
        [group.id, userId],
      );
      const target = await tx.query<{ role: string }>(
        "SELECT role FROM group_member WHERE group_id=$1 AND user_id=$2",
        [group.id, userId],
      );
      if (target.rows[0]?.role === "owner" && owners.rows[0].count === 0)
        throw new AppError(
          409,
          "LAST_OWNER",
          "Transfer ownership before stepping down.",
        );
    }
    const result = await tx.query(
      "UPDATE group_member SET role=$3,updated_at=now() WHERE group_id=$1 AND user_id=$2",
      [group.id, userId, input.role],
    );
    if (!result.rowCount)
      throw new AppError(404, "NOT_FOUND", "Member not found.");
    return { userId, role: input.role };
  });
}
/** Removal by an owner or the member themself; access ends on the next request. */
export async function removeMember(
  actor: Actor | null,
  groupId: string,
  userId: string,
) {
  writable();
  const a = requireActor(actor);
  const found = await getGroup(groupId, a);
  if (!found || !found.role)
    throw new AppError(404, "NOT_FOUND", "This group is unavailable.");
  if (userId !== a.id && found.role !== "owner")
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only a group owner can remove members.",
    );
  return transaction(async (tx) => {
    await tx.query('SELECT 1 FROM "group" WHERE id=$1 FOR UPDATE', [
      found.group.id,
    ]);
    const owners = await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM group_member WHERE group_id=$1 AND role='owner' AND user_id<>$2",
      [found.group.id, userId],
    );
    const target = await tx.query<{ role: string }>(
      "SELECT role FROM group_member WHERE group_id=$1 AND user_id=$2",
      [found.group.id, userId],
    );
    if (target.rows[0]?.role === "owner" && owners.rows[0].count === 0)
      throw new AppError(
        409,
        "LAST_OWNER",
        "Transfer ownership before leaving.",
      );
    const result = await tx.query(
      "DELETE FROM group_member WHERE group_id=$1 AND user_id=$2",
      [found.group.id, userId],
    );
    return { removed: (result.rowCount ?? 0) > 0 };
  });
}
