import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, launchCities, localDate } from "@taiwanhub/shared";
import { getLocale } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { tripCopy } from "@/lib/trip-copy";
import { getLayer, getMemberships } from "@/features/layers/repository";
import { getCollection } from "@/features/layers/collections";
import { layerTitle } from "@/lib/layer-labels";
import { NewTripForm } from "@/components/trips/new-trip-form";

export const metadata: Metadata = {
  title: "New trip",
  robots: { index: false },
};

/** Plan a trip from one layer (`?layer=`) or a folder (`?folder=`). */
export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!flags.trips) notFound();
  const [query, actor, locale] = await Promise.all([
    searchParams,
    currentActor(),
    getLocale(),
  ]);
  const t = tripCopy(locale);
  const layerParam = typeof query.layer === "string" ? query.layer : null;
  const folderParam = typeof query.folder === "string" ? query.folder : null;
  const back = `/trips/new?${layerParam ? `layer=${encodeURIComponent(layerParam)}` : `folder=${encodeURIComponent(folderParam ?? "")}`}`;
  if (!actor)
    return (
      <div className="container page-bottom">
        <div className="empty">
          <h1>{t.newTrip}</h1>
          <p>{t.signInToPlan}</p>
          <Link
            className="button"
            href={`/sign-in?next=${encodeURIComponent(back)}`}
          >
            {t.signIn}
          </Link>
        </div>
      </div>
    );
  let source: {
    kind: "layer" | "folder";
    id: string;
    name: string;
    timezone: string;
  } | null = null;
  let group: { id: string; name: string } | null = null;
  const memberships = await getMemberships(actor.id);
  if (layerParam) {
    const found = await getLayer(layerParam, actor);
    if (found) {
      source = {
        kind: "layer",
        id: found.layer.id,
        name: layerTitle(found.layer, locale),
        timezone: found.layer.timezone,
      };
      const role = found.layer.ownerGroupId
        ? memberships.get(found.layer.ownerGroupId)
        : null;
      if (found.layer.ownerGroupId && (role === "owner" || role === "editor"))
        group = { id: found.layer.ownerGroupId, name: found.layer.ownerName };
    }
  } else if (folderParam) {
    const folder = await getCollection(folderParam, actor);
    if (folder) {
      source = {
        kind: "folder",
        id: folder.id,
        name:
          locale === "zh-TW" && folder.titleChinese
            ? folder.titleChinese
            : folder.title,
        timezone:
          launchCities.find((c) => c.slug === folder.citySlug)?.timezone ??
          "UTC",
      };
      const role = folder.ownerGroupId
        ? memberships.get(folder.ownerGroupId)
        : null;
      if (folder.ownerGroupId && (role === "owner" || role === "editor"))
        group = { id: folder.ownerGroupId, name: folder.ownerName };
    }
  }
  if (!source)
    return (
      <div className="container page-bottom">
        <div className="empty">
          <h1>{t.newTrip}</h1>
          <p>{t.noPlaces}</p>
          <Link className="button secondary" href="/trips">
            {t.backToTrips}
          </Link>
        </div>
      </div>
    );
  const today = localDate(new Date(), source.timezone);
  return (
    <NewTripForm
      locale={locale}
      source={{ kind: source.kind, id: source.id, name: source.name }}
      group={group}
      defaultStart={addDays(today, 1)}
      defaultEnd={addDays(today, 2)}
    />
  );
}
