import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { supabaseRootCa } from "./supabase-ca";
const globalDb = globalThis as unknown as { taiwanhubPool?: Pool };
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://taiwanhub:taiwanhub@localhost:5432/taiwanhub";
const isLocalDb = ["localhost", "127.0.0.1"].includes(
  new URL(connectionString).hostname,
);
// Remote databases must verify the server certificate. The CA is inlined rather
// than read from disk so it survives serverless bundling. Managed providers sign
// with their own root, so DATABASE_CA_CERT (PEM) overrides the bundled CA.
function remoteCa() {
  const inline = process.env.DATABASE_CA_CERT;
  if (inline)
    return inline.includes("\\n") ? inline.split("\\n").join("\n") : inline;
  return supabaseRootCa;
}
export const pool =
  globalDb.taiwanhubPool ??
  new Pool({
    connectionString,
    max: 10,
    ssl: isLocalDb ? undefined : { rejectUnauthorized: true, ca: remoteCa() },
  });
if (process.env.NODE_ENV !== "production") globalDb.taiwanhubPool = pool;
export const db = drizzle(pool, { schema });
export { schema };
export { decideCandidate, revertRevision } from "./ingestion";
