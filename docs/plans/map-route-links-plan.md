# Map MVP: route links to Google Maps

Status: implemented 2026-10-21 behind `FEATURE_MAP_MVP` (owner request). No migration, no new keys, no Google API calls.

## Goal

A user picks places on the map in order and opens that route in Google Maps (stop 1 → stop 2 → stop 3).

## Why a link, not a drawn route

Google's terms forbid showing Google directions on a non-Google map, and Mapbox routing has no public transit. A [Google Maps URL](https://developers.google.com/maps/documentation/urls/get-started) needs no key, costs nothing, and opens Google's own routing (app on phones).

## Behavior

- No route mode (owner, 2026-10-22): a marker click always opens the place. Stops are added with **Add to route** / **Remove from route** on a pin's hover card or on an open place's details (the keyboard, list and phone path).
- **Route through these places** (Results tab) replaces the route with every located place on the map, in a short order: from each possible start, go to the nearest unvisited place, and keep the shortest path. More than 10 places keeps the first 10 of that order.
- Stops get numbered badges and a dashed straight line in order. The line shows the order only, not roads.
- While there are stops, a route bar sits in the map dock: stop count, **Edit** (opens the planner), **Open in Google Maps** when the route fits one link, and clear.
- The planner lists the stops (reorder, remove), a travel mode (Walk, Drive, Transit; default Walk) and the Google Maps link(s). **Done** closes it and keeps the stops; **Clear route** empties them.
- Directions start at stop 1, never at the user's location (owner, 2026-10-21): every link sets `origin`, because Google uses the device location when it is missing. A single stop is not a route and gets no link.
- Stops live in memory for the page view; nothing is stored or shared.

## Link rules

- Google places use `*_place_id` (with their coordinates as the required text value); catalog and custom places use coordinates. `waypoint_place_ids` is sent only when every waypoint has one.
- Phones accept at most 3 waypoints, so each link carries at most 5 stops (origin, 3 waypoints, destination). Longer routes split into parts; each later part starts at the previous part's last stop.
- Google Maps can't combine several transit stops, so Transit makes one link per leg.
- A route holds at most 10 stops.

## Labels

A Google stop is labeled by the name read from its pasted link (stored on the layer item since 2026-10-22), else its layer note, otherwise "Google Maps place". Google's own names are not stored. Catalog places use their name.

## Analytics

`route_opened` with stop count, link count and travel mode only, never places or locations.

## Out of scope

Saving or sharing routes, starting from the user's location, and drawing road routes on the map.
