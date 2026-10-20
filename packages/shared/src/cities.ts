/* ---------------------------------------------------------------------------
   Launch cities. The city table is the source of truth for which cities are
   supported; these definitions seed it (migration 0024 and seed-reference)
   and give each city its Traditional Chinese name, which the table does not
   store.
   --------------------------------------------------------------------------- */
export const launchCities = [
  {
    id: "00000000-0000-4000-8000-000000001002",
    slug: "taipei",
    name: "Taipei",
    nameChinese: "台北",
    region: "Taipei",
    country: "Taiwan",
    timezone: "Asia/Taipei",
    latitude: 25.033,
    longitude: 121.5654,
  },
  {
    id: "00000000-0000-4000-8000-000000001001",
    slug: "houston",
    name: "Houston",
    nameChinese: "休士頓",
    region: "TX",
    country: "USA",
    timezone: "America/Chicago",
    latitude: 29.7604,
    longitude: -95.3698,
  },
  {
    id: "00000000-0000-4000-8000-000000001003",
    slug: "tokyo",
    name: "Tokyo",
    nameChinese: "東京",
    region: "Tokyo",
    country: "Japan",
    timezone: "Asia/Tokyo",
    latitude: 35.6762,
    longitude: 139.6503,
  },
] as const;
const chineseNames = new Map<string, string>(
  launchCities.map((c) => [c.slug, c.nameChinese]),
);
/** The city's Chinese name for a city slug, if it has one. */
export function cityNameChinese(slug: string) {
  return chineseNames.get(slug) ?? null;
}
/** The city's display name in the given locale, falling back to its English name. */
export function localizedCityName(
  city: { slug: string; name: string },
  locale: string,
) {
  return (locale === "zh-TW" && cityNameChinese(city.slug)) || city.name;
}
