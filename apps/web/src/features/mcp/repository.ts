import { pool } from "@taiwanhub/database";

/** What the consent screen shows about a registered OAuth client. */
export async function getConsentClient(clientId: string) {
  const result = await pool.query<{
    name: string | null;
    redirect_uris: string[];
  }>(
    `SELECT name, redirect_uris FROM oauth_client WHERE client_id = $1 AND disabled IS NOT TRUE`,
    [clientId],
  );
  const row = result.rows[0];
  return row ? { name: row.name, redirectUris: row.redirect_uris } : null;
}
