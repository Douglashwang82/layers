import { pool } from "@taiwanhub/database";

/** The editable profile fields shown in the account settings form. */
export type ProfileSettings = {
  name: string;
  bio: string | null;
  preferredLanguage: string;
  homeCityId: string | null;
};

/** The member's own settings; the caller passes the session actor's id. */
export async function getProfileSettings(
  userId: string,
): Promise<ProfileSettings | null> {
  const result = await pool.query<ProfileSettings>(
    'SELECT name,bio,preferred_language AS "preferredLanguage",home_city_id AS "homeCityId" FROM "user" WHERE id=$1',
    [userId],
  );
  return result.rows[0] ?? null;
}
