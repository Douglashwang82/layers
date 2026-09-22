import { pool } from "@taiwanhub/database";
import type { Actor } from "@taiwanhub/shared";
import type { GroupRole } from "../layers/repository";
export type GroupSummary = {
  id: string;
  slug: string;
  name: string;
  nameChinese: string;
  cityId: string;
  role: GroupRole;
};
export type GroupRecord = {
  id: string;
  slug: string;
  name: string;
  nameChinese: string;
  description: string;
  cityId: string;
  citySlug: string;
  cityName: string;
  memberCount: number;
  createdAt: string;
};
export type GroupMember = {
  userId: string;
  name: string;
  role: GroupRole;
  joinedAt: string;
};
export type GroupInvite = {
  id: string;
  email: string;
  role: "editor" | "viewer";
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};
const columns = `g.id,g.slug,g.name,g.name_chinese AS "nameChinese",g.description,g.city_id AS "cityId",c.slug AS "citySlug",c.name AS "cityName",(SELECT count(*)::int FROM group_member m WHERE m.group_id=g.id) AS "memberCount",g.created_at AS "createdAt"`;
function record(row: Record<string, unknown>): GroupRecord {
  return {
    ...(row as Omit<GroupRecord, "createdAt">),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}
/** Groups where the user may create or edit layers. */
export async function listEditableGroups(
  userId: string,
): Promise<GroupSummary[]> {
  const result = await pool.query<GroupSummary>(
    `SELECT g.id,g.slug,g.name,g.name_chinese AS "nameChinese",g.city_id AS "cityId",m.role FROM "group" g JOIN group_member m ON m.group_id=g.id WHERE m.user_id=$1 AND m.role IN ('owner','editor') ORDER BY g.name`,
    [userId],
  );
  return result.rows;
}
export async function listMyGroups(userId: string): Promise<GroupSummary[]> {
  const result = await pool.query<GroupSummary>(
    `SELECT g.id,g.slug,g.name,g.name_chinese AS "nameChinese",g.city_id AS "cityId",m.role FROM "group" g JOIN group_member m ON m.group_id=g.id WHERE m.user_id=$1 ORDER BY g.name`,
    [userId],
  );
  return result.rows;
}
/** Group identity is public; members, invites and restricted layers are not. */
export async function getGroup(idOrSlug: string, actor: Actor | null) {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ${columns} FROM "group" g JOIN city c ON c.id=g.city_id WHERE g.slug=$1 OR g.id::text=$1`,
    [idOrSlug],
  );
  if (!result.rows[0]) return null;
  const group = record(result.rows[0]);
  const role = actor
    ? ((
        await pool.query<{ role: GroupRole }>(
          "SELECT role FROM group_member WHERE group_id=$1 AND user_id=$2",
          [group.id, actor.id],
        )
      ).rows[0]?.role ?? null)
    : null;
  return { group, role };
}
export async function listMembers(groupId: string): Promise<GroupMember[]> {
  const result = await pool.query<GroupMember>(
    `SELECT m.user_id AS "userId",u.name,m.role,m.created_at AS "joinedAt" FROM group_member m JOIN "user" u ON u.id=m.user_id WHERE m.group_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`,
    [groupId],
  );
  return result.rows.map((r) => ({
    ...r,
    joinedAt: new Date(r.joinedAt).toISOString(),
  }));
}
export async function listInvites(groupId: string): Promise<GroupInvite[]> {
  const result = await pool.query<GroupInvite>(
    `SELECT id,email,role,token,expires_at AS "expiresAt",accepted_at AS "acceptedAt",revoked_at AS "revokedAt" FROM group_invite WHERE group_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 50`,
    [groupId],
  );
  return result.rows.map((r) => ({
    ...r,
    expiresAt: new Date(r.expiresAt).toISOString(),
    acceptedAt: r.acceptedAt ? new Date(r.acceptedAt).toISOString() : null,
    revokedAt: r.revokedAt ? new Date(r.revokedAt).toISOString() : null,
  }));
}
/** The invitation a token names, with the group it opens, for the accept page. */
export async function getInviteByToken(token: string) {
  const result = await pool.query<{
    id: string;
    email: string;
    role: "editor" | "viewer";
    expires_at: Date;
    accepted_at: Date | null;
    revoked_at: Date | null;
    group_id: string;
    slug: string;
    name: string;
    name_chinese: string;
  }>(
    `SELECT i.id,i.email,i.role,i.expires_at,i.accepted_at,i.revoked_at,i.group_id,g.slug,g.name,g.name_chinese FROM group_invite i JOIN "group" g ON g.id=i.group_id WHERE i.token=$1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    groupId: row.group_id,
    groupSlug: row.slug,
    groupName: row.name,
    groupNameChinese: row.name_chinese,
    valid: !row.accepted_at && !row.revoked_at && row.expires_at > new Date(),
    accepted: !!row.accepted_at,
  };
}
