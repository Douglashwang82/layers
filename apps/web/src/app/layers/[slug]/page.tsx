import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { getCopy, getLocale, format, dateLabel } from "@/lib/i18n";
import { getActiveCity } from "@/lib/city";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import { getLayer } from "@/features/layers/repository";
import { getLayerContents } from "@/features/layers/contents";
import { LayerBadges, audienceLabel } from "@/components/layers/layer-card";
import {
  ApplyLayerButton,
  FollowLayerButton,
  OwnerActions,
  ShareLayerButton,
} from "@/components/layers/layer-actions";
import { LayerContentsList } from "@/components/layers/layer-contents";
import {
  layerTitle,
  ownerLabel,
  scheduleLabel,
} from "@/lib/layer-labels";
import { trackEvent } from "@/lib/analytics";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const found = await getLayer(slug, null);
  // Only publicly visible titles reach metadata; restricted layers stay neutral.
  return found
    ? {
        title: found.layer.title,
        robots: { index: found.layer.ownerKind === "system", follow: true },
      }
    : { title: "Layer", robots: { index: false } };
}
export default async function LayerPage({ params }: Props) {
  const [{ slug }, t, locale, actor] = await Promise.all([
    params,
    getCopy(),
    getLocale(),
    currentActor(),
  ]);
  const { city: activeCity } = await getActiveCity();
  const found = await getLayer(slug, actor, activeCity);
  if (!found)
    return (
      <div className="container page-bottom">
        <nav className="breadcrumbs" aria-label={t.back}>
          <Link href="/layers">← {t.layers}</Link>
        </nav>
        <div className="empty">
          <Lock size={24} aria-hidden="true" />
          <h3>{t.layerUnavailable}</h3>
          <p>{t.layerHelp}</p>
          {!actor && (
            <Link
              className="button secondary"
              href={`/sign-in?next=${encodeURIComponent(`/layers/${slug}`)}`}
            >
              {t.signIn}
            </Link>
          )}
        </div>
      </div>
    );
  const { layer, access } = found;
  const city = {
    ...activeCity,
    id: layer.cityId,
    slug: layer.citySlug,
    name: layer.cityName,
    timezone: layer.timezone,
  };
  const contents = await getLayerContents(layer, city, actor);
  await trackEvent(
    "layer_previewed",
    { layer: layer.slug, owner: layer.ownerKind },
    actor?.id,
  );
  const own = !!actor && layer.ownerUserId === actor.id;
  const description =
    locale === "zh-TW" && layer.descriptionChinese
      ? layer.descriptionChinese
      : layer.description;
  const counts = {
    places: contents.items.filter((i) => i.type === "place").length,
    events: contents.items.filter((i) => i.type === "event").length,
    content: contents.items.filter((i) => i.type === "content").length,
  };
  return (
    <div className="container page-bottom">
      <nav className="breadcrumbs" aria-label={t.back}>
        <Link href="/layers">← {t.layers}</Link>
      </nav>
      <header className="layer-detail-header">
        <LayerBadges layer={layer} t={t} />
        <h1>{layerTitle(layer, locale)}</h1>
        <p className="muted">
          {ownerLabel(layer, t, own)}
          {layer.ownerKind === "group" && layer.ownerSlug && (
            <>
              {" "}
              ·{" "}
              <Link href={`/groups/${layer.ownerSlug}`}>{layer.ownerName}</Link>
            </>
          )}{" "}
          · {audienceLabel(layer, t)} · {scheduleLabel(layer, t, locale)} ·{" "}
          {layer.cityName}
        </p>
        {description && <p>{description}</p>}
        <p className="fine-print">
          {format(t.updated, { date: dateLabel(layer.updatedAt, locale) })}
          {layer.updatedByName &&
            ` · ${format(t.updatedBy, { name: layer.updatedByName })}`}
          {layer.schedule !== "evergreen" &&
            ` · ${format(t.timezoneNote, { city: layer.cityName, zone: layer.timezone })}`}
        </p>
        {layer.audience === "group" && (
          <p className="notice">{t.audienceGroup}</p>
        )}
        <div className="actions">
          {access.apply && layer.lifecycle !== "archived" && (
            <ApplyLayerButton slug={layer.slug} t={t} />
          )}
          {access.apply &&
            layer.lifecycle !== "archived" &&
            contents.mapped > 0 && (
              <ApplyLayerButton slug={layer.slug} t={t} primary={false} only />
            )}
          {flags.layerWrites && layer.rule?.kind !== "saves" && !own && (
            <FollowLayerButton
              layerId={layer.id}
              following={access.following}
              authenticated={!!actor}
              t={t}
            />
          )}
          <ShareLayerButton layer={layer} t={t} />
        </div>
        {flags.layerWrites && (
          <OwnerActions layer={layer} access={access} t={t} locale={locale} />
        )}
      </header>
      <section className="section" aria-labelledby="contents-heading">
        <div className="section-heading">
          <div>
            <h2 id="contents-heading">{t.contents}</h2>
            <p>
              {format(t.contentsSummary, counts)}
              {contents.unmapped > 0 &&
                ` · ${format(t.mappedSummary, { mapped: contents.mapped, unmapped: contents.unmapped })}`}
            </p>
          </div>
        </div>
        {contents.items.length === 0 ? (
          <div className="empty">
            <h3>{t.emptyLayer}</h3>
            {access.edit && (
              <Link
                className="button secondary"
                href={`/layers/${layer.slug}/edit`}
              >
                {t.addItems}
              </Link>
            )}
          </div>
        ) : (
          <LayerContentsList
            items={contents.items}
            slug={layer.slug}
            t={t}
            locale={locale}
          />
        )}
      </section>
    </div>
  );
}
