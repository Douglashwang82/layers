import { Search } from "lucide-react";
import { kinds, listInput } from "@taiwanhub/shared";
import { listContent } from "@/features/catalog/repository";
import { getCopy, getLocale, format } from "@/lib/i18n";
import { getActiveCity } from "@/lib/city";
import { CardGrid, EmptyState, SectionHeading } from "@/components/cards";
import { flags } from "@/lib/config";
import { trackEvent } from "@/lib/analytics";
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; city?: string }>;
}) {
  const [query, t, locale] = await Promise.all([
    searchParams,
    getCopy(),
    getLocale(),
  ]);
  // Same city resolution as Home and the catalog: URL → cookie → Houston.
  const { city } = await getActiveCity(query.city);
  const input = listInput.parse({
    q: query.q?.slice(0, 100) ?? "",
    city: city.slug,
  });
  await trackEvent("search_performed", { query: input.q });
  const results = await Promise.all(
    kinds
      .filter(
        (k) =>
          (k !== "products" || flags.products) &&
          (k !== "organizations" || flags.organizations),
      )
      .map(async (kind) => ({ kind, ...(await listContent(kind, input)) })),
  );
  const total = results.reduce((sum, r) => sum + r.total, 0);
  const groupHref = (kind: string) =>
    `/${kind}?${new URLSearchParams({ q: input.q, city: input.city })}`;
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.searchResults}</h1>
        <p>{format(t.searchIn, { city: city.name })}</p>
      </div>
      <form className="filters" action="/search" role="search">
        {query.city && <input type="hidden" name="city" value={input.city} />}
        <div className="filters-row">
          <label className="filter-search">
            {t.search}
            <input
              type="search"
              name="q"
              defaultValue={input.q}
              autoFocus={!input.q}
              placeholder={t.searchPlaceholder}
            />
          </label>
          <button type="submit" className="button">
            <Search size={18} aria-hidden="true" />
            {t.search}
          </button>
        </div>
      </form>
      {input.q && (
        <p className="result-count" role="status">
          {format(t.resultCount, { count: total })}
        </p>
      )}
      {input.q && total === 0 ? (
        <EmptyState
          t={t}
          title={format(t.noResults, { q: input.q })}
          body={t.noResultsBody}
          action={{ href: "/places", label: t.exploreLink }}
        />
      ) : (
        results
          .filter((r) => !input.q || r.total > 0)
          .map((r) => (
            <section className="search-section" key={r.kind}>
              <SectionHeading
                title={`${t[r.kind]} (${r.total})`}
                t={t}
                href={r.total > 4 ? groupHref(r.kind) : undefined}
              />
              <CardGrid
                items={r.items.slice(0, 4)}
                kind={r.kind}
                variant="compact"
                {...{ t, locale }}
              />
            </section>
          ))
      )}
    </div>
  );
}
