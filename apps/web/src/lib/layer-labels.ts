import { brand } from "@taiwanhub/shared";
import { type Copy, type Locale, format } from "./dictionary";
/** Bilingual layer title with the original as fallback. */
export function layerTitle(
  layer: { title: string; titleChinese: string },
  locale: Locale,
) {
  return locale === "zh-TW" && layer.titleChinese
    ? layer.titleChinese
    : layer.title;
}
/**
 * One order for layers wherever they are listed, whatever is ticked: the
 * library's own order, then layers from outside it (shared links) by title.
 */
export function orderLayers<T extends { slug: string; title: string }>(
  layers: T[],
  library: { slug: string }[],
) {
  const rank = new Map(library.map((l, index) => [l.slug, index]));
  const place = (slug: string) => rank.get(slug) ?? Infinity;
  return [...layers].sort((a, b) => {
    const [first, second] = [place(a.slug), place(b.slug)];
    if (first !== second) return first < second ? -1 : 1;
    return a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug);
  });
}
function day(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso + "T00:00:00Z"));
}
/** Explains whether the layer's dates change automatically. */
export function scheduleLabel(
  layer: { schedule: string; startsOn: string | null; endsOn: string | null },
  t: Copy,
  locale: Locale,
) {
  if (layer.schedule === "rolling_today") return t.scheduleRolling;
  if (layer.schedule === "day" && layer.startsOn)
    return day(layer.startsOn, locale);
  if (layer.schedule === "range" && layer.startsOn && layer.endsOn)
    return `${day(layer.startsOn, locale)} – ${day(layer.endsOn, locale)}`;
  return t.scheduleEvergreen;
}
export function ownerLabel(
  layer: { ownerKind: string; ownerName: string },
  t: Copy,
  own: boolean,
) {
  if (layer.ownerKind === "system") return brand.name;
  if (own) return t.ownerYou;
  return format(t.byOwner, { name: layer.ownerName });
}
export function roleLabel(role: "owner" | "editor" | "viewer", t: Copy) {
  return role === "owner"
    ? t.roleOwner
    : role === "editor"
      ? t.roleEditor
      : t.roleViewer;
}
