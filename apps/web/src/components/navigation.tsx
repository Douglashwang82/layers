"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Map as MapIcon,
  Layers,
  Bookmark,
  UserRound,
  MapPin,
} from "lucide-react";
import type { Copy, Locale } from "@/lib/i18n";
/**
 * Route families owned by each destination. Whole path segments only.
 * Standalone catalog/detail pages (/places, /events, /explore, /products,
 * /organizations, /content) keep their own breadcrumb and highlight nothing.
 */
const routeFamilies: Record<string, string[]> = {
  "/": ["/"],
  "/layers": ["/layers", "/groups"],
  "/saved": ["/saved"],
  "/profile": ["/profile"],
};
export function isActiveRoute(pathname: string, href: string) {
  const families = routeFamilies[href] ?? [href];
  return families.some((base) =>
    base === "/"
      ? pathname === "/"
      : pathname === base || pathname.startsWith(base + "/"),
  );
}
export function Navigation({
  t,
  locale,
  cities,
  city,
}: {
  t: Copy;
  locale: Locale;
  cities: { id: string; slug: string; name: string }[];
  city: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const nav = [
    ["/", t.mapNav, MapIcon],
    ["/layers", t.layers, Layers],
    ["/saved", t.saved, Bookmark],
    ["/profile", t.profile, UserRound],
  ] as const;
  const current = (href: string) =>
    isActiveRoute(pathname, href) ? ("page" as const) : undefined;
  return (
    <>
      <header className="header">
        <Link href="/" className="brand" aria-label={t.brandHome}>
          <span className="brand-mark" aria-hidden="true">
            台
          </span>
          Taiwan<span>Hub</span>
        </Link>
        <nav className="desktop-nav" aria-label={t.mainNav}>
          {nav.slice(0, 3).map(([href, label]) => (
            <Link key={href} href={href} aria-current={current(href)}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <label className="city-select">
            <MapPin size={16} aria-hidden="true" />
            <span className="sr-only">{t.city}</span>
            <select
              value={city}
              disabled={switching}
              aria-busy={switching || undefined}
              onChange={async (e) => {
                const slug = e.target.value;
                setSwitching(true);
                try {
                  await fetch("/api/v1/preferences", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ city: slug }),
                  });
                  // The map replaces city-specific defaults and clears incompatible state.
                  if (pathname === "/") router.push(`/?city=${slug}`);
                  else router.refresh();
                } finally {
                  setSwitching(false);
                }
              }}
            >
              {cities.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="language-button"
            aria-label={t.language}
            lang={locale === "en" ? "zh-TW" : "en"}
            onClick={() => {
              document.cookie = `locale=${locale === "en" ? "zh-TW" : "en"};path=/;SameSite=Lax;max-age=31536000`;
              router.refresh();
            }}
          >
            {locale === "en" ? "繁中" : "EN"}
          </button>
          <Link
            href="/profile"
            className="sign-in"
            aria-current={current("/profile")}
          >
            <UserRound size={16} aria-hidden="true" />
            {t.profile}
          </Link>
        </div>
      </header>
      <nav className="bottom-nav" aria-label={t.mobileNav}>
        {nav.map(([href, label, Icon]) => (
          <Link key={href} href={href} aria-current={current(href)}>
            <Icon size={22} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
/** Global footer and demo banner; the map shell carries its own compact notices. */
export function SiteChrome({
  t,
  cityName,
  mapHome,
}: {
  t: Copy;
  cityName: string;
  mapHome: boolean;
}) {
  const pathname = usePathname();
  if (mapHome && pathname === "/") return null;
  return (
    <>
      <footer>
        <Link className="brand" href="/">
          Taiwan<span>Hub</span>
        </Link>
        <div>
          <p>{t.footer}</p>
          <small>{t.footerSmall}</small>
        </div>
        <span className="footer-city">{cityName}</span>
      </footer>
      <div className="demo-banner">{t.demo}</div>
    </>
  );
}
