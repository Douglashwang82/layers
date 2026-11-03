import { getCopy, getLocale } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { tripCopy } from "@/lib/trip-copy";
import { FolderPanel } from "@/components/layers/folder-panel";

/** The folder panel of the layer workspace (`layerPanel=folder&folder=slug`). */
export default async function FolderScreen({
  slug,
}: {
  slug: string | undefined;
}) {
  const [t, locale, actor] = await Promise.all([
    getCopy(),
    getLocale(),
    currentActor(),
  ]);
  return (
    <FolderPanel
      slug={slug}
      t={t}
      locale={locale}
      planTripLabel={
        flags.trips && actor ? tripCopy(locale).planTripFromFolder : undefined
      }
    />
  );
}
