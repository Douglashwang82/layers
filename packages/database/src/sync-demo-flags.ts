import { pool } from "./index";
const tables: Record<string, string> = {
  places: "place",
  events: "event",
  products: "product",
  organizations: "organization",
};
// Aligns published records with the demo status of the source that created
// them, repairing rows published before a source was marked as demo.
async function main() {
  const apply = process.argv.includes("--apply");
  for (const [kind, table] of Object.entries(tables)) {
    const drifted = await pool.query<{ id: string; name: string }>(
      `SELECT t.id,t.name FROM ${table} t
       JOIN entity_source es ON es.entity_id=t.id AND es.kind=$1
       JOIN source_record r ON r.id=es.source_record_id
       JOIN content_source s ON s.id=r.source_id
       WHERE t.is_demo <> s.is_demo`,
      [kind],
    );
    for (const row of drifted.rows)
      console.log(`${apply ? "fixing" : "would fix"} ${kind}: ${row.name}`);
    if (apply && drifted.rowCount)
      await pool.query(
        `UPDATE ${table} t SET is_demo=s.is_demo,updated_at=now()
         FROM entity_source es
         JOIN source_record r ON r.id=es.source_record_id
         JOIN content_source s ON s.id=r.source_id
         WHERE es.entity_id=t.id AND es.kind=$1 AND t.is_demo <> s.is_demo`,
        [kind],
      );
  }
  if (!apply) console.log("Dry run. Re-run with --apply to write changes.");
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
