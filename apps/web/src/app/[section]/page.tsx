import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import {
  kinds,
  listInput,
  placeCategories,
  eventCategories,
  type Kind,
} from "@taiwanhub/shared";
import { listContent } from "@/features/catalog/repository";
import { getCopy, getLocale, format } from "@/lib/i18n";
import { getActiveCity } from "@/lib/city";
import { CardGrid, EmptyState } from "@/components/cards";
import { MapView } from "@/components/map-view";
import { flags } from "@/lib/config";
import { serializeMapQuery } from "@taiwanhub/shared";
const pageSize = 12;
const neighborhoods = [
  "Bellaire",
  "Chinatown",
  "Katy",
  "Sugar Land",
  "Downtown Houston",
  "Midtown",
];
export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { section } = await params;
  const kind = (section === "explore" ? "places" : section) as Kind;
  if (
    !kinds.includes(kind) ||
    (kind === "products" && !flags.products) ||
    (kind === "organizations" && !flags.organizations)
  )
    notFound();
  const [t, locale, query] = await Promise.all([
    getCopy(),
    getLocale(),
    searchParams,
  ]);
  // Explicit URL city → cookie city → Houston, validated against supported cities.
  const { city } = await getActiveCity(query.city);
  const parsed = listInput.safeParse({ ...query, city: city.slug });
  const input = parsed.success
    ? parsed.data
    : listInput.parse({ city: city.slug });
  const view = kind === "places" && query.view === "map" ? "map" : "list";
  // Equivalent supported filters carry into the map workspace; unsupported ones stay on this page.
  const mapHref =
    kind === "places" || kind === "events"
      ? "/" +
        serializeMapQuery(
          {
            layers: [`discover-${city.slug}`],
            types: [kind === "places" ? "place" : "event"],
            q: input.q,
            date:
              kind === "events" &&
              (input.period === "today" || input.period === "weekend")
                ? input.period
                : "upcoming",
          },
          { includeCity: !!query.city },
        )
      : null;
  const result = await listContent(kind, input);
  const orgs =
    kind === "events"
      ? await listContent(
          "organizations",
          listInput.parse({ city: input.city }),
        )
      : null;
  const pages = Math.max(1, Math.ceil(result.total / pageSize));
  // Query-state contract: keep filters in the URL; every filter change returns to page 1.
  const current: Record<string, string> = {};
  for (const [key, value] of Object.entries(query))
    if (value && key !== "page") current[key] = value;
  const link = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...patch }))
      if (value) params.set(key, value);
    const qs = params.toString();
    return `/${section}${qs ? `?${qs}` : ""}`;
  };
  const optionalFilters = {
    q: input.q || undefined,
    category: input.category,
    neighborhood: input.neighborhood,
    organization: input.organization,
    period: input.period,
    sort: input.sort !== "popular" ? input.sort : undefined,
  };
  const activeFilters = Object.values(optionalFilters).filter(Boolean).length;
  const secondaryActive = Boolean(
    input.neighborhood ||
    input.organization ||
    (input.sort && input.sort !== "popular"),
  );
  const clearHref = link(
    Object.fromEntries(Object.keys(optionalFilters).map((k) => [k, undefined])),
  );
  const periods = [
    ["", t.upcoming],
    ["today", t.today],
    ["weekend", t.weekend],
    ["week", t.week],
  ] as const;
  const heading =
    kind === "places"
      ? t.eat
      : kind === "events"
        ? input.period
          ? periods.find(([value]) => value === input.period)![1]
          : t.upcomingEvents
        : kind === "products"
          ? t.products
          : t.community;
  const intro =
    kind === "places"
      ? t.popularIntro
      : kind === "events"
        ? t.weekendIntro
        : kind === "products"
          ? t.inventory
          : t.communityIntro;
  const categories =
    kind === "places"
      ? placeCategories
      : kind === "events"
        ? eventCategories
        : kind === "products"
          ? ["Snacks", "Pantry"]
          : ["Community"];
  const empty = input.q ? (
    <EmptyState
      t={t}
      title={format(t.noResults, { q: input.q })}
      body={t.noResultsBody}
      action={{ href: clearHref, label: t.clearFilters }}
    />
  ) : kind === "events" ? (
    <EmptyState
      t={t}
      body={t.noEventsBody}
      action={{ href: link({ period: undefined }), label: t.upcomingEvents }}
    />
  ) : (
    <EmptyState
      t={t}
      body={t.noPlacesBody}
      action={
        activeFilters ? { href: clearHref, label: t.clearFilters } : undefined
      }
    />
  );
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <p className="eyebrow">
          <MapPin size={14} aria-hidden="true" />
          {city.name}
        </p>
        <h1>{heading}</h1>
        <p>{intro}</p>
      </div>
      <nav className="tabs" aria-label={t.explore}>
        {kinds
          .filter(
            (k) =>
              k !== "events" &&
              (k !== "products" || flags.products) &&
              (k !== "organizations" || flags.organizations),
          )
          .map((k) => (
            <Link
              key={k}
              href={"/" + k}
              aria-current={kind === k ? "page" : undefined}
            >
              {t[k]}
            </Link>
          ))}
      </nav>
      {kind === "events" && (
        <nav className="segmented" aria-label={t.date}>
          {periods.map(([value, label]) => (
            <Link
              key={value}
              href={link({ period: value || undefined })}
              aria-current={(input.period ?? "") === value ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      <form className="filters" method="get" action={`/${section}`}>
        {query.city && <input type="hidden" name="city" value={input.city} />}
        {view === "map" && <input type="hidden" name="view" value="map" />}
        {kind === "events" && input.period && (
          <input type="hidden" name="period" value={input.period} />
        )}
        <div className="filters-row">
          <label className="filter-search">
            {t.search}
            <input
              type="search"
              name="q"
              defaultValue={input.q}
              placeholder={t.searchPlaceholder}
            />
          </label>
          <label>
            {t.category}
            <select name="category" defaultValue={input.category ?? ""}>
              <option value="">{t.all}</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="button">
            {t.search}
          </button>
          {kind === "places" && (
            <Link
              className="button secondary"
              href={link({ view: view === "map" ? undefined : "map" })}
            >
              {view === "map" ? t.list : t.map}
            </Link>
          )}
          {mapHref && flags.mapHome && (
            <Link className="button secondary" href={mapHref}>
              {t.mapEntry}
            </Link>
          )}
        </div>
        {(kind === "places" || kind === "events") && (
          <details className="filter-more" open={secondaryActive}>
            <summary>
              {t.moreFilters}
              {secondaryActive && (
                <span className="count-pill" aria-hidden="true">
                  {
                    [
                      input.neighborhood,
                      input.organization,
                      input.sort !== "popular" ? input.sort : "",
                    ].filter(Boolean).length
                  }
                </span>
              )}
            </summary>
            <div className="filters-row">
              <label>
                {t.neighborhood}
                <select
                  name="neighborhood"
                  defaultValue={input.neighborhood ?? ""}
                >
                  <option value="">{t.all}</option>
                  {neighborhoods.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              {kind === "places" && (
                <label>
                  {t.sort}
                  <select name="sort" defaultValue={input.sort}>
                    <option value="popular">{t.popularSort}</option>
                    <option value="score">{t.scoreSort}</option>
                  </select>
                </label>
              )}
              {kind === "events" && (
                <label>
                  {t.organizer}
                  <select
                    name="organization"
                    defaultValue={input.organization ?? ""}
                  >
                    <option value="">{t.all}</option>
                    {orgs?.items.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </details>
        )}
      </form>
      <div className="result-summary">
        <p className="result-count" role="status">
          {format(t.resultCount, { count: result.total })}
          {pages > 1 && ` · ${format(t.pageOf, { page: input.page, pages })}`}
        </p>
        {activeFilters > 0 && (
          <Link className="text-button" href={clearHref}>
            {t.clearFilters}
          </Link>
        )}
      </div>
      <div className={`catalog-layout ${view === "map" ? "with-map" : ""}`}>
        {view === "map" && (
          <div className="catalog-map">
            <MapView items={result.items} {...{ t, locale }} />
            <p className="fine-print">{t.mapScope}</p>
          </div>
        )}
        <div className="catalog-list">
          <CardGrid
            items={result.items}
            variant={view === "map" ? "compact" : "feature"}
            mobileRows={kind !== "events"}
            empty={empty}
            {...{ kind, t, locale }}
          />
        </div>
      </div>
      {pages > 1 && (
        <nav className="pagination" aria-label={t.pagination}>
          {input.page > 1 ? (
            <Link
              className="button secondary"
              href={link({
                page: input.page > 2 ? String(input.page - 1) : undefined,
              })}
            >
              ← {t.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="muted">
            {format(t.pageOf, { page: input.page, pages })}
          </span>
          {input.page < pages ? (
            <Link
              className="button secondary"
              href={link({ page: String(input.page + 1) })}
            >
              {t.loadMore} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
      {flags.submissions && (kind === "places" || kind === "events") && (
        <div className="contribute-row">
          <p className="muted">{t.join}</p>
          <Link
            className="button secondary"
            href={kind === "places" ? "/submit/place" : "/submit/event"}
          >
            {kind === "places" ? t.submitPlace : t.submitEvent}
          </Link>
        </div>
      )}
    </div>
  );
}
