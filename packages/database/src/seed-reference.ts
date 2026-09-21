import { db, pool, schema as s } from "./index";
import { placeCategories } from "../../shared/src";
const uid = (group: number, n: number) =>
  `00000000-0000-4000-8000-${String(group * 1000 + n).padStart(12, "0")}`;
async function main() {
  await db
    .insert(s.city)
    .values({
      id: uid(1, 1),
      slug: "houston",
      name: "Houston",
      region: "TX",
      country: "USA",
      timezone: "America/Chicago",
      latitude: 29.7604,
      longitude: -95.3698,
    })
    .onConflictDoNothing();
  for (const [i, name] of placeCategories.entries())
    await db
      .insert(s.placeCategory)
      .values({ id: uid(3, i), name })
      .onConflictDoNothing();
  console.log("Seeded reference data: 1 city, place categories.");
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
