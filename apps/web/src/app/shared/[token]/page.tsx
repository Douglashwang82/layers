import type { Metadata } from "next";
import { cache } from "react";
import { getCopy, getLocale } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { getLayer } from "@/features/layers/repository";
import {
  loadSharedLayer,
  trackSharedView,
} from "@/features/layers/share-links";
import {
  SharedLayerScreen,
  SharedLayerUnavailable,
} from "@/components/layers/shared-layer-view";

type Props = { params: Promise<{ token: string }> };
// One lookup serves both the metadata and the page.
const load = cache((token: string) => loadSharedLayer(token));
// The token is in the URL: never index it and never send it as a referrer.
const base = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
} as const;
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ token }, locale] = await Promise.all([params, getLocale()]);
  const view = await load(token);
  return {
    ...base,
    title: view
      ? (locale === "zh-TW" && view.titleChinese) || view.title
      : "Shared layer",
  };
}
export default async function SharedLayerPage({ params }: Props) {
  const [{ token }, t, locale, actor] = await Promise.all([
    params,
    getCopy(),
    getLocale(),
    currentActor(),
  ]);
  const view = await load(token);
  if (!view) return <SharedLayerUnavailable t={t} />;
  await trackSharedView(view.ownerKind, actor?.id).catch(() => {});
  // A signed-in viewer who can already open the layer gets a link into the app.
  const hasAccess = actor ? !!(await getLayer(view.layerId, actor)) : false;
  return (
    <SharedLayerScreen
      view={view}
      locale={locale}
      t={t}
      signedIn={!!actor}
      hasAccess={hasAccess}
    />
  );
}
