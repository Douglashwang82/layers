import { z } from "zod";
import { plainText } from "./text";
import { localDateTime } from "./time";
/* ---------------------------------------------------------------------------
   Events attached to a place inside a layer (docs/plans/layer-mvp-google-links-plan.md,
   M3/M8). LocalLink-only data: a single occurrence, located at its place,
   visible exactly as widely as the layer. Times are submitted as wall-clock
   values and converted with the layer city's time zone on the server.
   --------------------------------------------------------------------------- */
export const maxLayerEventDays = 31;
/** Layer membership keys that can carry an event: places of every origin. */
export const eventTargetKeyPattern = /^(place|subject|custom):([0-9a-f-]{36})$/;
const wallTime = z.string().regex(localDateTime, "Choose a date and time.");
const fields = {
  title: plainText(120),
  titleChinese: z.string().trim().max(120).default(""),
  startsAt: wallTime,
  endsAt: wallTime,
  note: z.string().trim().max(300).default(""),
};
const ordered = (v: { startsAt?: string; endsAt?: string }) =>
  !v.startsAt || !v.endsAt || v.startsAt <= v.endsAt;
export const layerEventInput = z
  .object({ key: z.string().regex(eventTargetKeyPattern), ...fields })
  .refine(ordered, {
    message: "The event must end after it starts.",
    path: ["endsAt"],
  });
export const layerEventPatchInput = z
  .object({
    title: fields.title.optional(),
    titleChinese: z.string().trim().max(120).optional(),
    startsAt: wallTime.optional(),
    endsAt: wallTime.optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine(ordered, {
    message: "The event must end after it starts.",
    path: ["endsAt"],
  });
/** An attached event as the map and editor read it. */
export type LayerEvent = {
  id: string;
  /** The place it is attached to: `place:`, `custom:` or `subject:` key. */
  key: string;
  layer: string;
  title: string;
  titleChinese: string;
  startTime: string;
  endTime: string;
  note: string;
};
