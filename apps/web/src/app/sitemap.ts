import type { MetadataRoute } from "next";
import { pool } from "@taiwanhub/database";
import { kinds } from "@taiwanhub/shared";
import { tables } from "@/features/catalog/repository";
import { appUrl } from "@/lib/config";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: appUrl, changeFrequency: "daily", priority: 1 },
  ];
  for (const kind of kinds) {
    const result = await pool.query<{ slug: string; updated_at: Date }>(
      `SELECT slug,updated_at FROM ${tables[kind]} WHERE status='approved' AND NOT is_demo LIMIT 10000`,
    );
    entries.push(
      ...result.rows.map((item) => ({
        url: `${appUrl}/${kind}/${item.slug}`,
        lastModified: item.updated_at,
      })),
    );
  }
  return entries;
}
