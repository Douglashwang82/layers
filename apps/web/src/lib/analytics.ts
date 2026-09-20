import { db, schema } from "@taiwanhub/database";
export async function trackEvent(
  name: string,
  properties: Record<string, string | number | boolean> = {},
  userId?: string,
) {
  await db.insert(schema.analyticsEvent).values({ name, properties, userId });
  if (process.env.ANALYTICS_CONSOLE === "true")
    console.info("[analytics]", name, properties);
}
