import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPinned, Plus } from "lucide-react";
import { currentActor } from "@/lib/session";
import { getSaved } from "@/features/catalog/repository";
import { getCopy, getLocale } from "@/lib/i18n";
import { CardGrid, EmptyState, SectionHeading } from "@/components/cards";
import { flags } from "@/lib/config";
import { mySavesSlug } from "@/features/layers/repository";
import { listSavedContent } from "@/features/content/repository";
import { FileText } from "lucide-react";
/**
 * Saves stay authoritative in their own tables. "My saves" is a private,
 * read-only map projection over them; a public layer is a separate creation.
 */
export default async function SavedPage() {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/saved");
  const [saved, t, locale, savedContent] = await Promise.all([
    getSaved(actor.id),
    getCopy(),
    getLocale(),
    flags.content ? listSavedContent(actor.id) : Promise.resolve([]),
  ]);
  const groups = (["places", "events", "products"] as const).filter(
    (kind) => kind !== "products" || flags.products,
  );
  const total =
    groups.reduce((sum, kind) => sum + (saved[kind]?.length ?? 0), 0) +
    savedContent.length;
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.saved}</h1>
        <p>{t.saveVsAdd}</p>
      </div>
      {total > 0 && (
        <div className="actions">
          {flags.mapHome && (
            <Link className="button" href={`/?layers=${mySavesSlug}`}>
              <MapPinned size={16} aria-hidden="true" />
              {t.showOnMap}
            </Link>
          )}
          {flags.layerWrites && (
            <Link className="button secondary" href="/layers/new">
              <Plus size={16} aria-hidden="true" />
              {t.createFromSaves}
            </Link>
          )}
        </div>
      )}
      {total === 0 ? (
        <EmptyState
          t={t}
          title={t.noSaved}
          body={t.noSavedBody}
          action={{ href: "/places", label: t.exploreLink }}
        />
      ) : (
        groups
          .filter((kind) => (saved[kind]?.length ?? 0) > 0)
          .map((kind) => (
            <section className="section" key={kind}>
              <SectionHeading
                title={`${t[kind]} (${saved[kind]!.length})`}
                t={t}
              />
              <CardGrid
                items={saved[kind]!}
                variant="compact"
                {...{ kind, t, locale }}
              />
            </section>
          ))
      )}
      {savedContent.length > 0 && (
        <section className="section">
          <SectionHeading
            title={`${t.localContent} (${savedContent.length})`}
            t={t}
          />
          <ul className="group-list">
            {savedContent.map((post) => (
              <li key={post.id}>
                <Link href={`/content/${post.slug}`}>
                  <FileText size={14} aria-hidden="true" />{" "}
                  {locale === "zh-TW" && post.titleChinese
                    ? post.titleChinese
                    : post.title}
                </Link>
                <span className="layer-badge">{post.authorName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
