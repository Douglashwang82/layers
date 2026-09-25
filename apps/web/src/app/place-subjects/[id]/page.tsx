import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentActor } from "@/lib/session";
import { getCopy, getLocale } from "@/lib/i18n";
import { flags, placesClientConfig } from "@/lib/config";
import { getSubjectDetail } from "@/features/place-subjects/repository";
import { SubjectPage } from "@/components/places/subject-page";
type Props = { params: Promise<{ id: string }> };
/** No provider data in metadata or indexes: the business name is shown only by the live component. */
export const metadata: Metadata = {
  title: "Place · TaiwanHub",
  robots: { index: false, follow: false },
};
/**
 * An authorized external place. A subject linked to the catalog redirects to
 * its canonical place page; missing and unauthorized subjects are both 404.
 */
export default async function PlaceSubjectPage({ params }: Props) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [actor, t, locale] = await Promise.all([
    currentActor(),
    getCopy(),
    getLocale(),
  ]);
  const detail = await getSubjectDetail(id, actor);
  if (!detail) notFound();
  if (detail.href !== `/place-subjects/${id}`) redirect(detail.href);
  const places = placesClientConfig();
  return (
    <div className="container page-bottom">
      <SubjectPage
        subjectId={detail.subjectId}
        placeId={detail.providerReference?.providerPlaceId ?? null}
        providerKey={places.providerKey}
        authenticated={!!actor}
        flags={{
          reviewWrites: places.reviewWrites,
          collections: places.collections,
          layerWrites: flags.layerWrites,
        }}
        t={t}
        locale={locale}
      />
    </div>
  );
}
