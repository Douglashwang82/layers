import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";
import { getSaved } from "@/features/catalog/repository";
import { getCopy, getLocale } from "@/lib/i18n";
import { CardGrid, SectionHeading } from "@/components/cards";
export default async function SavedPage() {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/saved");
  const [saved, t, locale] = await Promise.all([
    getSaved(actor.id),
    getCopy(),
    getLocale(),
  ]);
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.saved}</h1>
      </div>
      {(["places", "events", "products"] as const).map((kind) => (
        <section className="section" key={kind}>
          <SectionHeading title={t[kind]} t={t} />
          <CardGrid items={saved[kind] ?? []} {...{ kind, t, locale }} />
        </section>
      ))}
    </div>
  );
}
