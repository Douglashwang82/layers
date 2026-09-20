import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import {
  kinds,
  listInput,
  placeCategories,
  eventCategories,
  type Kind,
} from "@taiwanhub/shared";
import { listContent } from "@/features/catalog/repository";
import { getCopy, getLocale } from "@/lib/i18n";
import { CardGrid } from "@/components/cards";
import { MapView } from "@/components/map-view";
import { flags } from "@/lib/config";
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
  const [t, locale, query, jar] = await Promise.all([
    getCopy(),
    getLocale(),
    searchParams,
    cookies(),
  ]);
  const parsed = listInput.safeParse({
    ...query,
    city: query.city ?? jar.get("city")?.value ?? "houston",
  });
  const input = parsed.success ? parsed.data : listInput.parse({});
  const result = await listContent(kind, input);
  const orgs =
    kind === "events"
      ? await listContent(
          "organizations",
          listInput.parse({ city: input.city }),
        )
      : null;
  const link = (patch: Record<string, string>) =>
    `/${section}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined)), ...patch })}`;
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <span className="eyebrow">HOUSTON / TAIWANHUB</span>
        <h1>
          {kind === "places"
            ? t.eat
            : kind === "events"
              ? t.weekend
              : kind === "products"
                ? t.products
                : t.community}
        </h1>
        <p>
          {kind === "places"
            ? t.popularIntro
            : kind === "events"
              ? t.weekendIntro
              : kind === "products"
                ? t.inventory
                : t.communityIntro}
        </p>
      </div>
      <nav className="tabs">
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
      <form className="filters">
        <label>
          {t.search}
          <input name="q" defaultValue={input.q} placeholder={t.search} />
        </label>
        <label>
          {t.category}
          <select name="category" defaultValue={input.category ?? ""}>
            <option value="">{t.all}</option>
            {(kind === "places"
              ? placeCategories
              : kind === "events"
                ? eventCategories
                : kind === "products"
                  ? ["Snacks", "Pantry"]
                  : ["Community"]
            ).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {(kind === "places" || kind === "events") && (
          <label>
            {t.neighborhood}
            <select name="neighborhood" defaultValue={input.neighborhood ?? ""}>
              <option value="">{t.all}</option>
              {[
                "Bellaire",
                "Chinatown",
                "Katy",
                "Sugar Land",
                "Downtown Houston",
                "Midtown",
              ].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
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
          <>
            <label>
              {t.date}
              <select name="period" defaultValue={input.period ?? ""}>
                <option value="">{t.upcoming}</option>
                <option value="today">{t.today}</option>
                <option value="weekend">{t.weekend}</option>
                <option value="week">{t.week}</option>
              </select>
            </label>
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
          </>
        )}
        <button className="button dark">{t.search}</button>
        {kind === "places" && (
          <Link
            className="button secondary"
            href={link({ view: query.view === "map" ? "list" : "map" })}
          >
            {query.view === "map" ? t.list : t.map}
          </Link>
        )}
      </form>
      {query.view === "map" && kind === "places" && (
        <MapView items={result.items} t={t} />
      )}
      <CardGrid items={result.items} {...{ kind, t, locale }} />
      <div className="pagination">
        {input.page > 1 && (
          <Link href={link({ page: String(input.page - 1) })}>
            {t.previous}
          </Link>
        )}
        {input.page * 12 < result.total && (
          <Link href={link({ page: String(input.page + 1) })}>
            {t.loadMore} →
          </Link>
        )}
      </div>
      {flags.submissions && (kind === "places" || kind === "events") && (
        <Link
          className="button secondary"
          href={kind === "places" ? "/submit/place" : "/submit/event"}
        >
          {kind === "places" ? t.submitPlace : t.submitEvent} ↗
        </Link>
      )}
    </div>
  );
}
