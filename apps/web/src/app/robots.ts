import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/config";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/profile",
        "/saved",
        "/api/",
        // Shared layer links carry a secret token in the path.
        "/shared/",
        "/search",
      ],
    },
    sitemap: appUrl + "/sitemap.xml",
  };
}
