import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCopy, getLocale } from "@/lib/i18n";
import { getActiveCity } from "@/lib/city";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { listEditableGroups } from "@/features/groups/repository";
import { LayerEditor } from "@/components/layers/layer-editor";
export const metadata: Metadata = {
  title: "Create layer",
  robots: { index: false },
};
export default async function NewLayerPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string; next?: string; city?: string }>;
}) {
  const [query, actor] = await Promise.all([searchParams, currentActor()]);
  if (!flags.layerWrites) redirect("/layers");
  const returnTo = `/layers/new${query.add ? `?add=${encodeURIComponent(query.add)}${query.next ? `&next=${encodeURIComponent(query.next)}` : ""}` : ""}`;
  if (!actor) redirect("/sign-in?next=" + encodeURIComponent(returnTo));
  const [t, locale, { city }, groups] = await Promise.all([
    getCopy(),
    getLocale(),
    getActiveCity(query.city),
    listEditableGroups(actor.id),
  ]);
  const next =
    query.next && query.next.startsWith("/") && !query.next.startsWith("//")
      ? query.next
      : undefined;
  return (
    <div className="container">
      <LayerEditor
        mode="create"
        city={city}
        groups={groups
          .filter((g) => g.cityId === city.id)
          .map((g) => ({ id: g.id, name: g.name }))}
        t={t}
        locale={locale}
        addKey={query.add}
        next={next}
      />
    </div>
  );
}
