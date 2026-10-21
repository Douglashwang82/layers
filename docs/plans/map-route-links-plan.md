# Map MVP: route links to Google Maps

Status: implemented 2026-10-21 behind `FEATURE_MAP_MVP` (owner request). No migration, no new keys, no Google API calls.

## Goal

A user picks places on the map in order and opens that route in Google Maps (stop 1 → stop 2 → stop 3).

## Why a link, not a drawn route

Google's terms forbid showing Google directions on a non-Google map, and Mapbox routing has no public transit. A [Google Maps URL](https://developers.google.com/maps/documentation/urls/get-started) needs no key, costs nothing, and opens Google's own routing (app on phones).

## Behavior

- **Plan route** (map dock) turns on route mode and opens the route planner in the panel.
- In route mode, tapping a marker adds it as the next stop; tapping a stop again removes it. Stops get numbered badges and a dashed straight line in order. The line shows the order only, not roads.
- The planner lists the stops (reorder, remove), a travel mode (Walk, Drive, Transit; default Walk) and the Google Maps link(s). **Done** leaves route mode and keeps the stops; **Clear route** empties them.
- Keyboard and list path: an open place (from a marker or the list) shows **Add to route** / **Remove from route**.
- Directions start from the user's current location (no `origin`).
- Stops live in memory for the page view; nothing is stored or shared.

## Link rules

- Google places use `*_place_id` (with their coordinates as the required text value); catalog and custom places use coordinates. `waypoint_place_ids` is sent only when every waypoint has one.
- Phones accept at most 3 waypoints, so each link carries at most 4 new stops (3 waypoints + destination). Longer routes split into parts; each later part starts at the previous part's last stop.
- Google Maps can't combine several transit stops, so Transit makes one link per leg.
- A route holds at most 10 stops.

## Labels

Google place names are not stored (only the UI Kit card shows them), so a Google stop is labeled by its layer note when there is one, otherwise "Google Maps place". Catalog places use their name.

## Analytics

`route_opened` with stop count, link count and travel mode only, never places or locations.

## Out of scope

Saving or sharing routes, choosing a start point other than the current location, and drawing road routes on the map.
