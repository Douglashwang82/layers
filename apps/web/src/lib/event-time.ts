import type { LayerEvent } from "@taiwanhub/shared";
import type { Locale } from "./dictionary";
/** "Sat, Oct 25, 6:00 – 8:00 PM" in the city's time zone; ranges collapse shared parts. */
export function eventRange(
  event: Pick<LayerEvent, "startTime" | "endTime">,
  locale: Locale,
  timeZone: string,
) {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const start = new Date(event.startTime),
    end = new Date(event.endTime);
  return start.getTime() === end.getTime()
    ? formatter.format(start)
    : formatter.formatRange(start, end);
}
export function eventTitle(
  event: Pick<LayerEvent, "title" | "titleChinese">,
  locale: Locale,
) {
  return locale === "zh-TW" && event.titleChinese
    ? event.titleChinese
    : event.title;
}
