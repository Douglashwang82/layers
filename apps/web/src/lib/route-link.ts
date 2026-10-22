/**
 * Google Maps directions links for a user-ordered list of stops
 * (docs/plans/map-route-links-plan.md). Pure: no key, no requests.
 * https://developers.google.com/maps/documentation/urls/get-started
 */
export type RouteStop = { lat: number; lng: number; placeId?: string | null };
export type TravelMode = "walking" | "driving" | "transit";
export const travelModes: TravelMode[] = ["walking", "driving", "transit"];
export const maxRouteStops = 10;
/** Phones accept 3 waypoints plus the destination; transit cannot combine stops. */
const stopsPerLink: Record<TravelMode, number> = {
  walking: 4,
  driving: 4,
  transit: 1,
};
export type RouteLink = {
  /** 1-based stop number the link starts from. */
  from: number;
  /** 1-based stop number of the link's destination. */
  to: number;
  url: string;
};
const coordinates = (stop: RouteStop) =>
  `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`;
function directionsUrl(
  origin: RouteStop,
  stops: RouteStop[],
  mode: TravelMode,
) {
  // An explicit origin: without one Google starts at the user's location.
  const params = new URLSearchParams({
    api: "1",
    origin: coordinates(origin),
  });
  if (origin.placeId) params.set("origin_place_id", origin.placeId);
  const destination = stops[stops.length - 1];
  params.set("destination", coordinates(destination));
  if (destination.placeId)
    params.set("destination_place_id", destination.placeId);
  const waypoints = stops.slice(0, -1);
  if (waypoints.length) {
    params.set("waypoints", waypoints.map(coordinates).join("|"));
    // The IDs must match the waypoints one to one, so all or none.
    if (waypoints.every((w) => w.placeId))
      params.set(
        "waypoint_place_ids",
        waypoints.map((w) => w.placeId).join("|"),
      );
  }
  params.set("travelmode", mode);
  return `https://www.google.com/maps/dir/?${params}`;
}
/** Relative ground distance; enough to compare stops within a city. */
function distance(a: RouteStop, b: RouteStop) {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  const y = b.lat - a.lat;
  return Math.hypot(x, y);
}
/**
 * A short visiting order for "Route through these places": from each
 * possible start, always go to the nearest unvisited stop, and keep the
 * shortest of those paths. Not optimal, but sensible for a city layer.
 */
export function shortOrder<T extends RouteStop>(stops: T[]): T[] {
  let best: T[] = stops;
  let bestLength = Infinity;
  for (let start = 0; start < stops.length; start++) {
    const rest = stops.filter((_, i) => i !== start);
    const path = [stops[start]];
    let length = 0;
    while (rest.length) {
      const here = path[path.length - 1];
      let next = 0;
      for (let i = 1; i < rest.length; i++)
        if (distance(here, rest[i]) < distance(here, rest[next])) next = i;
      length += distance(here, rest[next]);
      path.push(...rest.splice(next, 1));
    }
    if (length < bestLength) {
      best = path;
      bestLength = length;
    }
  }
  return best;
}
/**
 * The links that open the route in order. The first starts at stop 1, each
 * later one at the previous link's last stop. A single stop is not a route,
 * so it has no link.
 */
export function routeLinks(stops: RouteStop[], mode: TravelMode): RouteLink[] {
  const size = stopsPerLink[mode];
  const links: RouteLink[] = [];
  for (let i = 1; i < stops.length; i += size) {
    const chunk = stops.slice(i, i + size);
    links.push({
      from: i,
      to: i + chunk.length,
      url: directionsUrl(stops[i - 1], chunk, mode),
    });
  }
  return links;
}
