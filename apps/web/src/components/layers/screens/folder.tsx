import { getCopy, getLocale } from "@/lib/i18n";
import { FolderPanel } from "@/components/layers/folder-panel";

/** The folder panel of the layer workspace (`layerPanel=folder&folder=slug`). */
export default async function FolderScreen({
  slug,
}: {
  slug: string | undefined;
}) {
  const [t, locale] = await Promise.all([getCopy(), getLocale()]);
  return <FolderPanel slug={slug} t={t} locale={locale} />;
}
