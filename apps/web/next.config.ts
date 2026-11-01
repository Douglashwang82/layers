import type { NextConfig } from "next";
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });
const nextConfig: NextConfig = {
  // Keep browser-test compilation separate from an open developer server.
  distDir: process.env.E2E_ISOLATED_BUILD === "true" ? ".next/e2e" : ".next",
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=()",
          },
        ],
      },
      // The secret share token is in these URLs; the last matching rule wins.
      {
        source: "/shared/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};
export default nextConfig;
