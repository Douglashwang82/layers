import type { Metadata } from "next";
import Link from "next/link";
import { dailyPickSlug, localDate, serializeMapQuery } from "@taiwanhub/shared";
import { getCopy, getLocale, format, localized } from "@/lib/i18n";
import { getActiveCity } from "@/lib/city";
import { currentActor } from "@/lib/session";
import {
  listDailyPickHistory,
  loadDailyPickView,
} from "@/features/daily-pick/repository";
import { DailyPickCard } from "@/components/daily-pick/daily-pick-card";
import { pickDateLabel, pickText } from "@/lib/daily-pick";
import { ApplyLayerButton } from "@/components/layers/layer-actions";
export const metadata: Metadata = { title: "Daily Pick" };
/**
 * Today's pick and dated history for the active city. Every entry is re-checked
 * against current visibility, so a place hidden later disappears from history.
 */
export default async function DailyPickPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const [query, t, locale, actor] = await Promise.all([
    searchParams,
    getCopy(),
    getLocale(),
    currentActor(),
  ]);
  const { city } = await getActiveCity(query.city);
  const today = localDate(new Date(), city.timezone);
  const [{ view }, history] = await Promise.all([
    loadDailyPickView(city, actor),
    listDailyPickHistory(city, today, 31),
  ]);
  const layer = dailyPickSlug(city.slug);
  const previous = history.filter((pick) => pick.date < today);
  return (
    <div className="container page-bottom">
      <nav className="breadcrumbs" aria-label={t.back}>
        <Link href="/layers">← {t.layers}</Link>
      </nav>
      <div className="page-header">
        <h1>
          {t.dailyPick} · {city.name}
        </h1>
        <p>{t.dailyPickIntro}</p>
        <div className="actions">
          <ApplyLayerButton slug={layer} t={t} />
        </div>
      </div>
      <div className="daily-pick-page">
        <DailyPickCard
          key={`${view.pick?.id ?? "none"}:${view.saved}`}
          view={view}
          cityName={city.name}
          citySlug={city.slug}
          t={t}
          locale={locale}
          authenticated={!!actor}
          mapHref={
            view.pick
              ? "/" +
                serializeMapQuery(
                  { city: city.slug, layers: [layer], item: view.pick.key },
                  { includeCity: true },
                )
              : undefined
          }
        />
        <section className="section" aria-labelledby="daily-pick-history">
          <h2 id="daily-pick-history">{t.dailyPickHistory}</h2>
          <p className="muted">
            {format(t.dailyPickHistoryIntro, { city: city.name })}
          </p>
          {previous.length === 0 ? (
            <p>{t.dailyPickNoHistory}</p>
          ) : (
            <ol className="daily-pick-history">
              {previous.map((pick) => (
                <li key={pick.id}>
                  <p className="eyebrow">
                    <time dateTime={pick.date}>
                      {pickDateLabel(pick.date, locale)}
                    </time>{" "}
                    · {pick.category}
                    {pick.neighborhood && ` · ${pick.neighborhood}`}
                    {pick.selectionKind === "editorial" && (
                      <span className="layer-badge">
                        {t.dailyPickEditorial}
                      </span>
                    )}
                  </p>
                  <h3>
                    <Link href={pick.href}>{localized(pick, locale)}</Link>
                  </h3>
                  <p>
                    <b>{t.dailyPickWhy}:</b> {pickText(pick, locale).reason}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
