import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";
async function main() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
  await migrate(db, { migrationsFolder: "packages/database/migrations" });
  console.log("Migrations applied.");
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
