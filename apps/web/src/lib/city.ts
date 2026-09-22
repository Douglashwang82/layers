import { cookies } from "next/headers";
import { getCities } from "@/features/catalog/repository";
export const defaultCitySlug = "houston";
export type City = Awaited<ReturnType<typeof getCities>>[number];
const fallbackCity: City = {
  id: "",
  slug: defaultCitySlug,
  name: "Houston",
  timezone: "America/Chicago",
  latitude: 29.7604,
  longitude: -95.3698,
};
/** First supported city among the candidates, otherwise the launch city. */
export function pickCity(
  cities: City[],
  ...candidates: (string | undefined)[]
) {
  for (const slug of candidates) {
    const match = slug && cities.find((c) => c.slug === slug);
    if (match) return match;
  }
  return (
    cities.find((c) => c.slug === defaultCitySlug) ?? cities[0] ?? fallbackCity
  );
}
/** Explicit URL city, then the city cookie, then Houston — validated against supported cities. */
export async function getActiveCity(requested?: string) {
  const [cities, jar] = await Promise.all([getCities(), cookies()]);
  return { cities, city: pickCity(cities, requested, jar.get("city")?.value) };
}
