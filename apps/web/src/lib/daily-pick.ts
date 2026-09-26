import type { Locale } from "./dictionary";
/** The text a pick card needs; structurally matches DailyPickCard. */
type PickCopy = {
  description: string;
  descriptionChinese: string;
  reasonText: string;
  reasonTextChinese: string;
};
const weekdaysEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthsEn = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const weekdaysZh = "日一二三四五六";
/**
 * A pick date is a city-local calendar date (YYYY-MM-DD). It is formatted from
 * fixed tables rather than Intl, whose zh-TW spacing differs between Node and
 * browsers and would make server and client render different text.
 */
export function pickDateLabel(date: string, locale: Locale) {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return locale === "zh-TW"
    ? `${m}月${d}日（週${weekdaysZh[weekday]}）`
    : `${weekdaysEn[weekday]}, ${monthsEn[m - 1]} ${d}`;
}
/** Chinese snapshots when present, English otherwise. */
export function pickText(pick: PickCopy, locale: Locale) {
  const zh = locale === "zh-TW";
  return {
    description: (zh && pick.descriptionChinese) || pick.description,
    reason: (zh && pick.reasonTextChinese) || pick.reasonText,
  };
}
