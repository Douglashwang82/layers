import { db, pool, schema as s } from "./index";
import { launchCities, placeCategorySeedOrder } from "../../shared/src";
import { ensureSystemLayers } from "./system-layers";
const uid = (group: number, n: number) =>
  `00000000-0000-4000-8000-${String(group * 1000 + n).padStart(12, "0")}`;
async function main() {
  // Migration 0024 already adds Taipei and Tokyo; this keeps a fresh
  // database's launch cities complete either way (idempotent by slug).
  for (const city of launchCities)
    await db
      .insert(s.city)
      .values({
        id: city.id,
        slug: city.slug,
        name: city.name,
        region: city.region,
        country: city.country,
        timezone: city.timezone,
        latitude: city.latitude,
        longitude: city.longitude,
      })
      .onConflictDoNothing();
  for (const [i, name] of placeCategorySeedOrder.entries())
    await db
      .insert(s.placeCategory)
      .values({ id: uid(3, i), name })
      .onConflictDoNothing();
  for (const city of launchCities) await ensureSystemLayers(pool, city);
  console.log(
    `Seeded reference data: ${launchCities.length} cities, place categories, system layers.`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
