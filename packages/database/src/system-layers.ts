import type { Pool, PoolClient } from "pg";
/**
 * System layers are public rule-backed collections owned by TaiwanHub. One set
 * exists per city; the rule kind is allowlisted and versioned. The migration
 * creates them for existing cities, seeds create them for new cities.
 */
export const systemLayerDefinitions = [
  {
    kind: "discover",
    slug: (city: string) => `discover-${city}`,
    title: (name: string) => `Discover ${name}`,
    titleChinese: (name: string) => `探索${name}`,
    description: "Approved local places and upcoming events.",
    descriptionChinese: "已審核的在地店家與即將舉行的活動。",
    schedule: "evergreen",
  },
  {
    kind: "today",
    slug: (city: string) => `today-${city}`,
    title: (name: string) => `Today in ${name}`,
    titleChinese: (name: string) => `今天的${name}`,
    description:
      "Events happening today and editorial food picks. Updates every day.",
    descriptionChinese: "今天的活動與精選美食，每天自動更新。",
    schedule: "rolling_today",
  },
  {
    kind: "weekend",
    slug: (city: string) => `weekend-${city}`,
    title: () => "This weekend",
    titleChinese: () => "本週末",
    description: "Events from Saturday through Sunday. Updates every week.",
    descriptionChinese: "週六到週日的活動，每週自動更新。",
    schedule: "evergreen",
  },
  {
    kind: "food",
    slug: (city: string) => `food-${city}`,
    title: () => "Taiwanese food favorites",
    titleChinese: () => "台灣人的美食愛店",
    description:
      "Restaurants, bakeries and tea shops recommended by neighbors.",
    descriptionChinese: "鄰居推薦的餐廳、麵包店與茶飲店。",
    schedule: "evergreen",
  },
  {
    kind: "community",
    slug: (city: string) => `community-${city}`,
    title: () => "Community gatherings",
    titleChinese: () => "社群聚會",
    description: "Social, student, family and professional meetups.",
    descriptionChinese: "社交、學生、家庭與職涯聚會。",
    schedule: "evergreen",
  },
] as const;
export const systemLayerSql = `INSERT INTO layer(slug,title,title_chinese,description,description_chinese,city_id,owner_kind,audience,schedule,rule,lifecycle,review_status)
SELECT $1,$2,$3,$4,$5,$6,'system','public',$7,$8::jsonb,'active','approved'
ON CONFLICT (slug) DO NOTHING`;
export async function ensureSystemLayers(
  client: Pool | PoolClient,
  city: { id: string; slug: string; name: string },
) {
  for (const def of systemLayerDefinitions)
    await client.query(systemLayerSql, [
      def.slug(city.slug),
      def.title(city.name),
      def.titleChinese(city.name),
      def.description,
      def.descriptionChinese,
      city.id,
      def.schedule,
      JSON.stringify({ version: 1, kind: def.kind }),
    ]);
}
