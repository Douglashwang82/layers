import type { Metadata } from "next";
import { brand } from "@taiwanhub/shared";
import { Navigation, SiteChrome } from "@/components/navigation";
import { getActiveCity } from "@/lib/city";
import { getCopy, getLocale } from "@/lib/i18n";
import { appUrl, flags } from "@/lib/config";
import "./globals.css";
import "./pages.css";
import "./map.css";
import "./responsive.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: `${brand.name} — Local places, events and communities in Taipei, Houston and Tokyo`,
    template: `%s | ${brand.name}`,
  },
  description:
    "Map the places, events and communities you care about in Taipei, Houston and Tokyo, together with your neighbors.",
  openGraph: { siteName: brand.name, type: "website" },
  robots: { index: true, follow: true },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [t, locale, { cities, city }] = await Promise.all([
    getCopy(),
    getLocale(),
    getActiveCity(),
  ]);
  return (
    <html lang={locale}>
      <body>
        <a className="skip-link" href="#main">
          {t.skipLink}
        </a>
        <Navigation
          {...{ t, locale, cities }}
          city={city.slug}
          mapHome={flags.mapHome}
        />
        <main id="main">{children}</main>
        <SiteChrome t={t} cityName={city.name} mapHome={flags.mapHome} />
      </body>
    </html>
  );
}
