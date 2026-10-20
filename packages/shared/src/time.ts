import { z } from "zod";
/* ---------------------------------------------------------------------------
   Zoned date/time helpers shared by the map date filter and the daily-pick
   pipelines. Dates: half-open intervals resolved at a location's local day
   boundaries, computed with Intl so DST transitions are handled correctly.
   --------------------------------------------------------------------------- */
export const isoDate = /^\d{4}-\d{2}-\d{2}$/;
export function daysBetween(a: string, b: string) {
  return Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000,
  );
}
export function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      get("weekday"),
    ),
  };
}
/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
/** The instant when the given calendar date begins in a time zone, DST-safe. */
export function zonedMidnight(isoDay: string, timeZone: string) {
  const [y, m, d] = isoDay.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const local = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    const diff = local - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}
/** `YYYY-MM-DDTHH:mm` wall-clock time, as a `datetime-local` input submits it. */
export const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/**
 * The instant a wall-clock time occurs in a time zone, DST-safe (the same
 * fixed-point search as zonedMidnight).
 */
export function zonedDateTime(local: string, timeZone: string) {
  const [day, time] = local.split("T");
  const [y, m, d] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, hours, minutes);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const diff =
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}
/** The `YYYY-MM-DDTHH:mm` wall-clock time of an instant in a time zone. */
export function localDateTimeOf(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
export function addDays(isoDay: string, days: number) {
  const t = Date.parse(isoDay + "T00:00:00Z") + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
export const isoDateSchema = z.string().regex(isoDate);
