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
  if (layer.ownerKind === "system") return "TaiwanHub";
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
