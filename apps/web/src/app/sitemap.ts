import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/config";
export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    { url: appUrl, changeFrequency: "daily", priority: 1 },
  ];
  // Only the home page is indexed; the legacy catalog stays reachable but unlisted.
  return entries;
}
