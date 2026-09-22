import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { getCopy, getLocale, format } from "@/lib/i18n";
import { getActiveCity } from "@/lib/city";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import {
  listLibrary,
  type LayerWithAccess,
  type LibraryScope,
} from "@/features/layers/repository";
import { LayerCard } from "@/components/layers/layer-card";
import { CreateLayerLink } from "@/components/layers/layer-actions";
import { EmptyState } from "@/components/cards";
import { listMyGroups } from "@/features/groups/repository";
import { roleLabel } from "@/lib/layer-labels";
export const metadata: Metadata = { title: "Layers" };
const scopes: LibraryScope[] = ["discover", "following", "mine", "groups"];
/** Discover is grouped by intent and finite; the other tabs are the user's own library. */
function groupDiscover(entries: LayerWithAccess[]) {
  const groups: Record<string, LayerWithAccess[]> = {
    today: [],
    food: [],
    weekend: [],
    community: [],
    other: [],
  };
  for (const entry of entries) {
    const kind = entry.layer.rule?.kind;
    if (kind === "today" || kind === "discover") groups.today.push(entry);
    else if (kind === "food") groups.food.push(entry);
    else if (kind === "weekend") groups.weekend.push(entry);
    else if (kind === "community") groups.community.push(entry);
    else groups.other.push(entry);
  }
  return groups;
}
export default async function LayersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; city?: string }>;
}) {
  const [query, t, locale, actor] = await Promise.all([
    searchParams,
    getCopy(),
    getLocale(),
    currentActor(),
  ]);
  const { city } = await getActiveCity(query.city);
  const tab: LibraryScope = scopes.includes(query.tab as LibraryScope)
    ? (query.tab as LibraryScope)
    : "discover";
  const q = (query.q ?? "").slice(0, 100);
  const [entries, myGroups] = await Promise.all([
    listLibrary(tab, actor, city, q),
    tab === "groups" && actor ? listMyGroups(actor.id) : Promise.resolve([]),
  ]);
  const labels: Record<LibraryScope, string> = {
    discover: t.libraryDiscover,
    following: t.libraryFollowing,
    mine: t.libraryMine,
    groups: t.libraryGroups,
  };
  const href = (scope: LibraryScope) =>
    `/layers?tab=${scope}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const groups = tab === "discover" ? groupDiscover(entries) : null;
  const groupLabels: Record<string, string> = {
    today: t.groupToday,
    food: t.groupFood,
    weekend: t.groupWeekend,
    community: t.groupCommunity,
    other: t.groupOther,
  };
  const empty =
    tab === "mine"
      ? t.noLayersMine
      : tab === "following"
        ? t.noFollowing
        : tab === "groups"
          ? t.noGroups
          : t.noLayersFound;
  const cards = (list: LayerWithAccess[]) => (
    <div className="layer-cards">
      {list.map((entry) => (
        <LayerCard
          key={entry.layer.id}
          entry={entry}
          t={t}
          locale={locale}
          own={!!actor && entry.layer.ownerUserId === actor.id}
        />
      ))}
    </div>
  );
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.layers}</h1>
        <p>
          {t.layersIntro} {t.layerWord}: {t.layerHelp}
        </p>
      </div>
      <div className="actions">
        {flags.layerWrites && <CreateLayerLink t={t} authenticated={!!actor} />}
        <Link className="button secondary" href="/">
          {t.mapEntry}
        </Link>
      </div>
      <nav className="library-tabs" aria-label={t.layers}>
        {scopes.map((scope) => (
          <Link
            key={scope}
            href={href(scope)}
            aria-current={tab === scope ? "page" : undefined}
          >
            {labels[scope]}
          </Link>
        ))}
      </nav>
      <form className="filters" action="/layers" role="search">
        <input type="hidden" name="tab" value={tab} />
        <div className="filters-row">
          <label className="filter-search">
            {t.search}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t.searchLayers}
            />
          </label>
          <button type="submit" className="button">
            <Search size={18} aria-hidden="true" />
            {t.search}
          </button>
        </div>
      </form>
      {!actor && tab !== "discover" ? (
        <EmptyState
          t={t}
          title={format(t.signInFor, { action: labels[tab] })}
          body={t.authBody}
          action={{
            href: `/sign-in?next=${encodeURIComponent(href(tab))}`,
            label: t.signIn,
          }}
        />
      ) : tab === "groups" && actor ? (
        <>
          <section className="library-group" aria-labelledby="my-groups">
            <div className="section-heading">
              <div>
                <h2 id="my-groups">{t.yourGroups}</h2>
                <p>{t.groupIntro}</p>
              </div>
              {flags.layerWrites && (
                <Link className="button secondary small" href="/groups/new">
                  {t.createGroup}
                </Link>
              )}
            </div>
            {myGroups.length === 0 ? (
              <p className="muted">{t.noGroups}</p>
            ) : (
              <ul className="group-list">
                {myGroups.map((g) => (
                  <li key={g.id}>
                    <Link href={`/groups/${g.slug}`}>
                      {locale === "zh-TW" && g.nameChinese
                        ? g.nameChinese
                        : g.name}
                    </Link>
                    <span className="layer-badge">{roleLabel(g.role, t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {entries.length > 0 && (
            <section className="library-group" aria-labelledby="group-layers">
              <h2 id="group-layers">{t.groupLayers}</h2>
              {cards(entries)}
            </section>
          )}
        </>
      ) : entries.length === 0 ? (
        <EmptyState
          t={t}
          title={empty}
          body={q ? t.noResultsBody : t.layerHelp}
          action={{ href: "/layers", label: t.libraryDiscover }}
        />
      ) : groups ? (
        Object.entries(groups)
          .filter(([, list]) => list.length > 0)
          .map(([key, list]) => (
            <section
              className="library-group"
              key={key}
              aria-labelledby={`group-${key}`}
            >
              <h2 id={`group-${key}`}>{groupLabels[key]}</h2>
              {cards(list)}
            </section>
          ))
      ) : (
        <section className="library-group">{cards(entries)}</section>
      )}
    </div>
  );
}
