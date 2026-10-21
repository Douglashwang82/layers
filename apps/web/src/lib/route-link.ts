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
  /** 1-based stop number the link starts from; null is the user's location. */
  from: number | null;
  /** 1-based stop number of the link's destination. */
  to: number;
  url: string;
};
const coordinates = (stop: RouteStop) =>
  `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`;
function directionsUrl(
  origin: RouteStop | null,
  stops: RouteStop[],
  mode: TravelMode,
) {
  const params = new URLSearchParams({ api: "1" });
  if (origin) {
    params.set("origin", coordinates(origin));
    if (origin.placeId) params.set("origin_place_id", origin.placeId);
  }
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
/**
 * The links that open the route in order. The first starts at the user's
 * location; each later one starts at the previous link's last stop.
 */
export function routeLinks(stops: RouteStop[], mode: TravelMode): RouteLink[] {
  const size = stopsPerLink[mode];
  const links: RouteLink[] = [];
  for (let i = 0; i < stops.length; i += size) {
    const chunk = stops.slice(i, i + size);
    links.push({
      from: i === 0 ? null : i,
      to: i + chunk.length,
      url: directionsUrl(i === 0 ? null : stops[i - 1], chunk, mode),
    });
  }
  return links;
}
