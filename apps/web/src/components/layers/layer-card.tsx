import Link from "next/link";
import type { LayerWithAccess } from "@/features/layers/repository";
import { type Copy, type Locale, format, dateLabel } from "@/lib/dictionary";
import {
  layerTitle,
  ownerLabel,
  scheduleLabel,
} from "@/lib/layer-labels";
import { ApplyLayerButton } from "./layer-actions";
export function audienceLabel(layer: LayerWithAccess["layer"], t: Copy) {
  if (layer.ownerKind === "system") return t.audiencePublic;
  if (layer.audience === "group") return t.audienceGroup;
  if (layer.audience === "public")
    return layer.reviewStatus === "approved"
      ? t.audiencePublic
      : layer.reviewStatus === "pending"
        ? t.pendingReview
        : layer.reviewStatus === "rejected"
          ? t.rejected
          : t.statusHidden;
  return t.audiencePrivate;
}
export function LayerBadges({
  layer,
  t,
}: {
  layer: LayerWithAccess["layer"];
  t: Copy;
}) {
  const audience = audienceLabel(layer, t);
  const audienceClass =
    layer.audience === "public" && layer.reviewStatus === "approved"
      ? "public"
      : layer.audience === "public"
        ? "pending"
        : "";
  return (
    <div className="layer-badges">
      <span className={`layer-badge ${audienceClass}`}>{audience}</span>
      {layer.lifecycle === "draft" && (
        <span className="layer-badge">{t.draft}</span>
      )}
      {layer.lifecycle === "archived" && (
        <span className="layer-badge">{t.archived}</span>
      )}
    </div>
  );
}
/** Discovery card: title, owner, audience, schedule, purpose, size and a labeled Apply control. */
export function LayerCard({
  entry,
  t,
  locale,
  own,
}: {
  entry: LayerWithAccess;
  t: Copy;
  locale: Locale;
  own: boolean;
}) {
  const { layer } = entry;
  const description =
    locale === "zh-TW" && layer.descriptionChinese
      ? layer.descriptionChinese
      : layer.description;
  return (
    <article className="layer-card">
      <LayerBadges layer={layer} t={t} />
      <h3>
        <Link href={`/layers/${layer.slug}`}>{layerTitle(layer, locale)}</Link>
      </h3>
      <p className="muted">
        {ownerLabel(layer, t, own)} · {scheduleLabel(layer, t, locale)}
      </p>
      {description && <p className="description">{description}</p>}
      <p className="layer-meta">
        {layer.rule
          ? layer.rule.kind === "saves"
            ? t.showOnMap
            : t.scheduleRolling === scheduleLabel(layer, t, locale)
              ? t.scheduleRolling
              : format(t.updated, { date: dateLabel(layer.updatedAt, locale) })
          : `${format(t.itemsCount, { count: layer.itemCount })} · ${format(t.updated, { date: dateLabel(layer.updatedAt, locale) })}`}
      </p>
      <div className="actions">
        <ApplyLayerButton slug={layer.slug} t={t} />
        <Link className="button secondary" href={`/layers/${layer.slug}`}>
          {t.viewLayer}
        </Link>
      </div>
    </article>
  );
}
