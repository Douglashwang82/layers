import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/navigation";
import { getActiveCity } from "@/lib/city";
import { getCopy, getLocale } from "@/lib/i18n";
import { appUrl } from "@/lib/config";
import "./globals.css";
import "./pages.css";
import "./responsive.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "TaiwanHub — Houston through Taiwanese eyes",
    template: "%s | TaiwanHub",
  },
  description:
    "Discover restaurants, weekend events, and Taiwanese finds with your Houston community.",
  openGraph: { siteName: "TaiwanHub", type: "website" },
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
        <Navigation {...{ t, locale, cities }} city={city.slug} />
        <main id="main">{children}</main>
        <footer>
          <Link className="brand" href="/">
            Taiwan<span>Hub</span>
          </Link>
          <div>
            <p>{t.footer}</p>
            <small>{t.footerSmall}</small>
          </div>
          <span className="footer-city">{city.name}</span>
        </footer>
        <div className="demo-banner">{t.demo}</div>
      </body>
    </html>
  );
}
