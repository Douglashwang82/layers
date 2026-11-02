import type { Metadata } from "next";
import { LayerLink as Link } from "../workspace-navigation";
import { redirect } from "next/navigation";
import { getCopy, getLocale } from "@/lib/i18n";
import { getActiveCity } from "@/lib/city";
import { currentActor } from "@/lib/session";
import { flags, placesClientConfig } from "@/lib/config";
import { listEditableGroups } from "@/features/groups/repository";
import { LayerEditor } from "@/components/layers/layer-editor";
import { GoogleLinksForm } from "@/components/layers/google-links-form";
export const metadata: Metadata = {
  title: "Create layer",
  robots: { index: false },
};
export default async function NewLayerPage({
  searchParams,
}: {
  searchParams: Promise<{
    add?: string;
    next?: string;
    city?: string;
    group?: string;
    blank?: string;
  }>;
}) {
  const [query, actor] = await Promise.all([searchParams, currentActor()]);
  if (!flags.layerWrites) redirect("/layers");
  const returnParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) returnParams.set(key, value);
  const returnTo = `/layers/new?${returnParams}`;
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
  const cityGroups = groups
    .filter((g) => g.cityId === city.id)
    .map((g) => ({ id: g.id, name: g.name }));
  // Layers are built from Google Maps links; adding a known item or asking
  // for a blank layer keeps the plain editor.
  if (!query.add && !query.blank)
    return (
      <div className="container">
        <section className="form-panel">
          <h1>{t.createFromGoogle}</h1>
          <GoogleLinksForm
            mode="create"
            city={{ slug: city.slug, name: city.name }}
            groups={cityGroups}
            providerKey={placesClientConfig().providerKey}
            t={t}
            locale={locale}
          />
          <p className="fine-print">
            {/* Keep the group, city and return path when switching editors. */}
            <Link
              href={`/layers/new?${new URLSearchParams({ ...Object.fromEntries(returnParams), blank: "1" })}`}
            >
              {t.createEmptyLayer}
            </Link>
          </p>
        </section>
      </div>
    );
  return (
    <div className="container">
      <LayerEditor
        mode="create"
        city={city}
        groups={cityGroups}
        t={t}
        locale={locale}
        addKey={query.add}
        next={next}
        groupId={query.group}
      />
    </div>
  );
}
