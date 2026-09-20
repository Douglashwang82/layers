"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Compass,
  CalendarDays,
  Bookmark,
  UserRound,
  MapPin,
  ArrowUpRight,
} from "lucide-react";
import type { Copy, Locale } from "@/lib/i18n";
export function Navigation({
  t,
  locale,
  cities,
}: {
  t: Copy;
  locale: Locale;
  cities: { id: string; slug: string; name: string }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = [
    ["/", t.home, Home],
    ["/explore", t.explore, Compass],
    ["/events", t.events, CalendarDays],
    ["/saved", t.saved, Bookmark],
    ["/profile", t.profile, UserRound],
  ] as const;
  return (
    <>
      <header className="header">
        <Link href="/" className="brand" aria-label="TaiwanHub home">
          <span className="brand-mark">台</span>Taiwan<span>Hub</span>
          <i>・</i>
        </Link>
        <nav className="desktop-nav" aria-label="Main">
          {nav.slice(0, 4).map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <label className="city-select">
            <MapPin size={15} />
            <span className="sr-only">{t.city}</span>
            <select
              aria-label={t.city}
              onChange={async (e) => {
                await fetch("/api/v1/preferences", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ city: e.target.value }),
                });
                router.refresh();
              }}
            >
              {cities.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}, TX
                </option>
              ))}
            </select>
          </label>
          <button
            className="language-button"
            aria-label={t.language}
            onClick={() => {
              document.cookie = `locale=${locale === "en" ? "zh-TW" : "en"};path=/;SameSite=Lax;max-age=31536000`;
              router.refresh();
            }}
          >
            {locale === "en" ? "繁中" : "EN"}
          </button>
          <Link href="/profile" className="sign-in">
            {t.profile}
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </header>
      <nav className="bottom-nav" aria-label="Mobile">
        {nav.map(([href, label, Icon]) => (
          <Link
            key={href}
            href={href}
            aria-current={
              (href === "/" ? pathname === "/" : pathname.startsWith(href))
                ? "page"
                : undefined
            }
          >
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
