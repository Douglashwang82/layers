"use client";
import { brand, localizedCityName } from "@taiwanhub/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Map as MapIcon,
  Layers,
  Bookmark,
  UserRound,
  MapPin,
  Globe,
  Menu,
} from "lucide-react";
import type { Copy, Locale } from "@/lib/i18n";
import { format } from "@/lib/dictionary";
import { useMapTheme, type MapThemePreference } from "@/lib/map-theme";
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
  mapHome = false,
}: {
  t: Copy;
  locale: Locale;
  cities: { id: string; slug: string; name: string }[];
  city: string;
  mapHome?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const mapPage = mapHome && pathname === "/";
  const [switching, setSwitching] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const mapTheme = useMapTheme();
  // The floating menu is non-modal: an outside press dismisses it.
  useEffect(() => {
    if (!mapPage) return;
    const close = (event: PointerEvent) => {
      const node = menu.current;
      if (node?.open && !node.contains(event.target as Node)) node.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [mapPage]);
  const nav = [
    ["/", t.mapNav, MapIcon],
    ["/layers", t.layers, Layers],
    ["/saved", t.saved, Bookmark],
    ["/profile", t.profile, UserRound],
  ] as const;
  const current = (href: string) =>
    isActiveRoute(pathname, href) ? ("page" as const) : undefined;
  const nextLanguage = locale === "en" ? "繁體中文" : "English";
  const authLanguageButton = (
    <button
      type="button"
      className="language-button language-button--labeled"
      aria-label={format(t.languageSwitchTo, { language: nextLanguage })}
      lang={locale === "en" ? "zh-TW" : "en"}
      onClick={() => {
        document.cookie = `locale=${locale === "en" ? "zh-TW" : "en"};path=/;SameSite=Lax;max-age=31536000`;
        router.refresh();
      }}
    >
      <Globe size={16} aria-hidden="true" />
      {nextLanguage}
    </button>
  );
  const languageButton = (
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
  );
  if (pathname === "/sign-in") {
    return (
      <header className="auth-entry-header">
        <Link href="/" className="auth-entry-brand" aria-label={t.brandHome}>
          <span className="auth-entry-mark" aria-hidden="true" />
          Local<span>Link</span>
        </Link>
        {authLanguageButton}
      </header>
    );
  }
  const citySelect = (
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
            {localizedCityName(c, locale)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <header className={`header ${mapPage ? "map-header" : ""}`}>
        {mapPage ? (
          <div className="map-top-left">
            <div className="map-identity">
              <Link href="/" className="brand" aria-label={t.brandHome}>
                <span className="brand-mark" aria-hidden="true">
                  L
                </span>
                <span className="brand-name">{brand.name}</span>
              </Link>
              {citySelect}
            </div>
            <div id="map-header-search" />
          </div>
        ) : (
          <>
            <Link href="/" className="brand" aria-label={t.brandHome}>
              <span className="brand-mark" aria-hidden="true">
                L
              </span>
              Local<span>Link</span>
            </Link>
            <nav className="desktop-nav" aria-label={t.mainNav}>
              {nav.slice(0, 3).map(([href, label]) => (
                <Link key={href} href={href} aria-current={current(href)}>
                  {label}
                </Link>
              ))}
            </nav>
          </>
        )}
        <div className="header-tools">
          {mapPage ? (
            <>
              <div id="map-header-actions" />
              <details
                ref={menu}
                className="map-profile-menu"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary className="map-float-button" title={t.menu}>
                  <Menu size={20} aria-hidden="true" />
                  <span>{t.menu}</span>
                </summary>
                <div className="map-profile-options">
                  {nav.map(([href, label, Icon]) => (
                    <Link key={href} href={href} aria-current={current(href)}>
                      <Icon size={18} aria-hidden="true" />
                      {label}
                    </Link>
                  ))}
                  {languageButton}
                  <div
                    className="map-theme-control"
                    role="radiogroup"
                    aria-label={t.mapTheme}
                  >
                    {(
                      [
                        ["system", t.mapThemeSystem],
                        ["light", t.mapThemeLight],
                        ["dark", t.mapThemeDark],
                      ] as [MapThemePreference, string][]
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={mapTheme.preference === value}
                        onClick={() => mapTheme.setPreference(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </details>
            </>
          ) : (
            <>
              {citySelect}
              {languageButton}
              <Link
                href="/profile"
                className="sign-in"
                aria-current={current("/profile")}
              >
                <UserRound size={16} aria-hidden="true" />
                {t.profile}
              </Link>
            </>
          )}
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
  if (pathname === "/sign-in" || (mapHome && pathname === "/")) return null;
  return (
    <>
      <footer>
        <Link className="brand" href="/">
          Local<span>Link</span>
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
