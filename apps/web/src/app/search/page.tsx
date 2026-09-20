import { kinds, listInput } from "@taiwanhub/shared";
import { listContent } from "@/features/catalog/repository";
import { getCopy, getLocale } from "@/lib/i18n";
import { CardGrid, SectionHeading } from "@/components/cards";
import { flags } from "@/lib/config";
import { trackEvent } from "@/lib/analytics";
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [query, t, locale] = await Promise.all([
    searchParams,
    getCopy(),
    getLocale(),
  ]);
  const input = listInput.parse({ q: query.q?.slice(0, 100) ?? "" });
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
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.searchResults}</h1>
      </div>
      <form className="filters">
        <label>
          {t.search}
          <input
            name="q"
            defaultValue={input.q}
            autoFocus
            placeholder={t.searchPlaceholder}
          />
        </label>
        <button className="button">{t.search}</button>
      </form>
      {results.map((r) => (
        <section className="search-section" key={r.kind}>
          <SectionHeading
            title={`${t[r.kind]} (${r.total})`}
            t={t}
            href={`/${r.kind}?q=${encodeURIComponent(input.q)}`}
          />
          <CardGrid
            items={r.items.slice(0, 4)}
            kind={r.kind}
            {...{ t, locale }}
          />
        </section>
      ))}
    </div>
  );
}
