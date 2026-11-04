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
type MapEndpoint = {
  itemId: string;
  location: { lat: number; lng: number };
};
type MapDay = {
  id: string;
  stops: MapStop[];
  start?: MapEndpoint | null;
  end?: MapEndpoint | null;
};

/** The base and day endpoints: one color and a house, so they never read as a stop. */
export const endpointColor = dayColors[dayColors.length - 1];
export const endpointLabel = "⌂";

/** Whether a day (by index) is drawn dotted: the palette has wrapped. */
export const dottedDay = (index: number) => index >= dayColors.length;

const shown = (id: string, focus: string) => focus === "all" || focus === id;

/** A day's start and end, which only count when it has a stop to reach. */
function endpoints(day: MapDay) {
  if (!day.stops.some((s) => s.location)) return [];
  return [day.start, day.end].filter((e): e is MapEndpoint => Boolean(e));
}

/**
 * The open trip as GeoJSON for the main map: one straight LineString per day
 * (visiting order, not roads, from the day's start through its stops to its
 * end) and a numbered Point per located stop. Stops without a location are
 * never drawn. A place several days start or end at is drawn once.
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
  const drawn = new Set<string>();
  days.forEach((day, index) => {
    if (!shown(day.id, focus)) return;
    const color = dayColor(index);
    const located = day.stops.filter((s) => s.location);
    const ends = endpoints(day);
    const path = [
      ...(day.start && ends.length ? [day.start.location] : []),
      ...located.map((s) => s.location!),
      ...(day.end && ends.length ? [day.end.location] : []),
    ];
    if (path.length > 1)
      features.push({
        type: "Feature",
        properties: { color, dotted: dottedDay(index) ? 1 : 0 },
        geometry: {
          type: "LineString",
          coordinates: path.map((p) => [p.lng, p.lat]),
        },
      });
    for (const end of ends) {
      if (drawn.has(end.itemId)) continue;
      drawn.add(end.itemId);
      features.push({
        type: "Feature",
        properties: {
          color: endpointColor,
          label: endpointLabel,
          stopId: "",
          selected: 0,
        },
        geometry: {
          type: "Point",
          coordinates: [end.location.lng, end.location.lat],
        },
      });
    }
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

/** Coordinates the camera frames for the focused days, base included. */
export function tripPoints(days: MapDay[], focus: string) {
  return days
    .filter((day) => shown(day.id, focus))
    .flatMap((day) => [
      ...day.stops.flatMap((s) => (s.location ? [s.location] : [])),
      ...endpoints(day).map((e) => e.location),
    ]);
}
