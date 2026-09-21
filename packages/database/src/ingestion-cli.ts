import "dotenv/config";
import { z } from "zod";
import { pool } from "./index";
import { ingestionKinds, runCollection, validateSourceUrl } from "./ingestion";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "run") {
    const dryRun = args.includes("--dry-run");
    const sourceArg = args.find((arg) => arg !== "--dry-run");
    const sourceId = sourceArg ? z.uuid().parse(sourceArg) : undefined;
    const result = await runCollection({ sourceId, dryRun });
    console.log(JSON.stringify(result, null, 2));
    if ("failed" in result && (result.failed || result.errors.length))
      process.exitCode = 1;
    return;
  }
  if (command === "sources") {
    console.table(
      (
        await pool.query(
          "SELECT id,name,kind,url,owner,permission_note,attribution,enabled,is_demo,allow_auto_update,interval_hours,last_success_at,consecutive_failures FROM content_source ORDER BY name",
        )
      ).rows,
    );
    return;
  }
  if (command === "source-policy") {
    const id = z.uuid().parse(args[0]);
    const owner = z.string().trim().min(1).max(120).parse(args[1]);
    const note = z.string().trim().min(10).max(1000).parse(args[2]);
    const attribution = z
      .string()
      .trim()
      .max(300)
      .parse(args[3] ?? "");
    const result = await pool.query(
      "UPDATE content_source SET owner=$1,permission_note=$2,attribution=$3,updated_at=now() WHERE id=$4",
      [owner, note, attribution, id],
    );
    if (!result.rowCount) throw new Error("Source not found.");
    console.log(`Recorded source policy for ${id}.`);
    return;
  }
  if (command === "add-source") {
    const demo = args.includes("--demo");
    const [kindRaw, citySlug, urlRaw, ...nameParts] = args.filter(
      (a) => a !== "--demo",
    );
    const kind = z.enum(ingestionKinds).parse(kindRaw);
    const url = (
      await validateSourceUrl(z.url({ protocol: /^https$/ }).parse(urlRaw))
    ).toString();
    const name = nameParts.join(" ").trim();
    if (!name || name.length > 120)
      throw new Error("Provide a source name (up to 120 characters).");
    const city =
      citySlug === "global"
        ? null
        : (
            await pool.query<{ id: string }>(
              "SELECT id FROM city WHERE slug=$1",
              [citySlug],
            )
          ).rows[0]?.id;
    if (citySlug !== "global" && !city) throw new Error("Unknown city slug.");
    if (kind !== "products" && !city)
      throw new Error("A local content source needs a city.");
    const result = await pool.query<{ id: string }>(
      "INSERT INTO content_source(name,url,kind,city_id,is_demo) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [name, url, kind, city, demo],
    );
    console.log(
      `Added disabled${demo ? " demo" : ""} source ${result.rows[0].id}. Review its permission and feed before enabling.`,
    );
    return;
  }
  if (command === "demo-source") {
    const id = z.uuid().parse(args[0]);
    const value = z.enum(["on", "off"]).parse(args[1]) === "on";
    const result = await pool.query(
      "UPDATE content_source SET is_demo=$1,updated_at=now() WHERE id=$2",
      [value, id],
    );
    if (!result.rowCount) throw new Error("Source not found.");
    console.log(`Set is_demo=${value} for ${id}.`);
    return;
  }
  if (command === "enable-source" || command === "disable-source") {
    const id = z.uuid().parse(args[0]);
    if (command === "enable-source") {
      const policy = (
        await pool.query<{ permission_note: string | null }>(
          "SELECT permission_note FROM content_source WHERE id=$1",
          [id],
        )
      ).rows[0];
      if (!policy?.permission_note)
        throw new Error(
          "Record the source owner and permission note before enabling it.",
        );
    }
    const result = await pool.query(
      "UPDATE content_source SET enabled=$1,updated_at=now() WHERE id=$2",
      [command === "enable-source", id],
    );
    if (!result.rowCount) throw new Error("Source not found.");
    console.log(
      `${command === "enable-source" ? "Enabled" : "Disabled"} ${id}`,
    );
    return;
  }
  if (command === "auto-update" || command === "interval") {
    const id = z.uuid().parse(args[0]);
    const value =
      command === "auto-update"
        ? z.enum(["on", "off"]).parse(args[1]) === "on"
        : z.coerce.number().int().min(1).max(720).parse(args[1]);
    const column =
      command === "auto-update" ? "allow_auto_update" : "interval_hours";
    const result = await pool.query(
      `UPDATE content_source SET ${column}=$1,updated_at=now() WHERE id=$2`,
      [value, id],
    );
    if (!result.rowCount) throw new Error("Source not found.");
    console.log(`Updated ${column} for ${id}.`);
    return;
  }
  throw new Error(
    "Usage: pnpm ingest <run [source-id] [--dry-run] | sources | add-source KIND CITY-SLUG HTTPS-URL NAME [--demo] | source-policy ID OWNER NOTE [ATTRIBUTION] | enable-source ID | disable-source ID | demo-source ID on|off | auto-update ID on|off | interval ID HOURS>",
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
