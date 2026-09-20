import { pool } from "./index";
async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: pnpm admin:grant email@example.com");
  const result = await pool.query(
    'UPDATE "user" SET role = $1, updated_at = now() WHERE email = $2 RETURNING id',
    ["ADMIN", email],
  );
  if (!result.rowCount) throw new Error("Create the account first.");
  console.log("Admin access granted to existing account.");
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
