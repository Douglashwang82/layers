/** Day colors; days 8–14 reuse them with a dotted line. Color is never the only cue. */
export const dayColors = [
  "#006A51",
  "#3B4FC4",
  "#A3480F",
  "#7A3E9D",
  "#805600",
  "#0E6E8C",
  "#14261F",
];
export const dayColor = (index: number) => dayColors[index % dayColors.length];

type MapStop = {
  id: string;
  location: { lat: number; lng: number } | null;
};
type MapDay = { id: string; stops: MapStop[] };

/** Whether a day (by index) is drawn dotted: the palette has wrapped. */
export const dottedDay = (index: number) => index >= dayColors.length;

const shown = (id: string, focus: string) => focus === "all" || focus === id;

/**
 * The open trip as GeoJSON for the main map: one straight LineString per day
 * (visiting order, not roads) and a numbered Point per located stop. Stops
 * without a location are never drawn.
 */
export function tripGeoJSON(
  days: MapDay[],
  focus: string,
  selectedStopId: string | null,
) {
  const features: Array<
    | {
        type: "Feature";
        properties: { color: string; dotted: number };
        geometry: { type: "LineString"; coordinates: number[][] };
      }
    | {
        type: "Feature";
        properties: {
          color: string;
          label: string;
          stopId: string;
          selected: number;
        };
        geometry: { type: "Point"; coordinates: number[] };
      }
  > = [];
  days.forEach((day, index) => {
    if (!shown(day.id, focus)) return;
    const color = dayColor(index);
    const located = day.stops.filter((s) => s.location);
    if (located.length > 1)
      features.push({
        type: "Feature",
        properties: { color, dotted: dottedDay(index) ? 1 : 0 },
        geometry: {
          type: "LineString",
          coordinates: located.map((s) => [s.location!.lng, s.location!.lat]),
        },
      });
    located.forEach((stop, i) =>
      features.push({
        type: "Feature",
        properties: {
          color,
          label: focus === "all" ? `${index + 1}·${i + 1}` : String(i + 1),
          stopId: stop.id,
          selected: stop.id === selectedStopId ? 1 : 0,
        },
        geometry: {
          type: "Point",
          coordinates: [stop.location!.lng, stop.location!.lat],
        },
      }),
    );
  });
  return { type: "FeatureCollection" as const, features };
}

export type TripGeoJSON = ReturnType<typeof tripGeoJSON>;

/** Coordinates the camera frames for the focused days. */
export function tripPoints(days: MapDay[], focus: string) {
  return days
    .filter((day) => shown(day.id, focus))
    .flatMap((day) => day.stops)
    .flatMap((s) => (s.location ? [s.location] : []));
}
