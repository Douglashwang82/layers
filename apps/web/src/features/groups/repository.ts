import { pool } from "@taiwanhub/database";
export type GroupSummary = {
  id: string;
  slug: string;
  name: string;
  nameChinese: string;
  cityId: string;
  role: "owner" | "editor" | "viewer";
};
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
