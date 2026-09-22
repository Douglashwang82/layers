import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getSaved } from "@/features/catalog/repository";
import { getCopy, getLocale } from "@/lib/i18n";
import { CardGrid, EmptyState, SectionHeading } from "@/components/cards";
import { flags } from "@/lib/config";
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
      </div>
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
