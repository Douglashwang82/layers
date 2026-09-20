import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
const globalDb = globalThis as unknown as { taiwanhubPool?: Pool };
export const pool =
  globalDb.taiwanhubPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://taiwanhub:taiwanhub@localhost:5432/taiwanhub",
    max: 10,
  });
if (process.env.NODE_ENV !== "production") globalDb.taiwanhubPool = pool;
export const db = drizzle(pool, { schema });
export { schema };
export { decideCandidate, revertRevision } from "./ingestion";
