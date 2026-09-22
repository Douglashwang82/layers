import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPinned, Plus } from "lucide-react";
import { currentActor } from "@/lib/session";
import { getSaved } from "@/features/catalog/repository";
import { getCopy, getLocale } from "@/lib/i18n";
import { CardGrid, EmptyState, SectionHeading } from "@/components/cards";
import { flags } from "@/lib/config";
import { mySavesSlug } from "@/features/layers/repository";
/**
 * Saves stay authoritative in their own tables. "My saves" is a private,
 * read-only map projection over them; a public layer is a separate creation.
 */
export default async function SavedPage() {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/saved");
  const [saved, t, locale] = await Promise.all([
    getSaved(actor.id),
    getCopy(),
    getLocale(),
  ]);
  const groups = (["places", "events", "products"] as const).filter(
    (kind) => kind !== "products" || flags.products,
  );
  const total = groups.reduce(
    (sum, kind) => sum + (saved[kind]?.length ?? 0),
    0,
  );
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
    </div>
  );
}
