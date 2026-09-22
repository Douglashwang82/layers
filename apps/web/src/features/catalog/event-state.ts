import type { Content } from "./repository";
export type EventState = "open" | "full" | "cancelled" | "postponed" | "ended";
/** The server stays authoritative; this only drives labels and the disabled state. */
export function eventStateOf(
  item: Pick<Content, "eventStatus" | "endTime" | "capacity" | "attending">,
  now = new Date(),
): EventState {
  return item.eventStatus === "cancelled"
    ? "cancelled"
    : item.eventStatus === "postponed"
      ? "postponed"
      : item.endTime && new Date(item.endTime) < now
        ? "ended"
        : item.capacity != null && item.attending >= item.capacity
          ? "full"
          : "open";
}
