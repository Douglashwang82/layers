# Importing shared maps

Open **Profile → Import a shared map**, or the import link in a private/group
layer's editor. This requires `FEATURE_LAYER_CUSTOM_PLACES=true` and layer writes
enabled. Collections remain readable when layer writes are disabled.

Paste a public Google My Maps viewer/edit link, or upload its KML/KMZ export.
Link downloads are best-effort: Google's export endpoint is not a versioned API.
If sharing permissions or an endpoint change prevent downloading, use My Maps'
**Export to KML/KMZ** menu and upload the file. No geocoding or LLM calls are
made. Matching markers to Google places (below) uses the server-only
`GOOGLE_MAPS_LINK_API_KEY`; without it, imports still work, unmatched.

The preview shows source folders, selectable named point markers, coordinates,
plain-text descriptions, and a skipped-feature count. Review the destination and
duplicate estimate before confirming the import. The reuse confirmation records
the user's assertion that they have permission to use the source content.

Destinations:

- Add to an editable private/group layer, with a revision check.
- Create one private/group layer containing the selected markers.
- Preserve each selected source folder as a separate layer inside a named
  **layer collection**. Nested folder names become paths; empty folders are omitted.

A collection is an organizer, distinct from a community group. Its owner is a user
or group; group members may view it. Every child layer is independently checked
for access. Open **Profile → Layer collections** to select layers and show them
on the map. The existing limit of five applied layers still applies; larger
collections are viewed in subsets. Collections currently organize layers created
by the import; arbitrary membership editing and collection deletion are not exposed.

## Data behavior and limits

- One-time copies only; source edits and deletions never sync automatically.
- The selected city organizes the layer. Original coordinates are retained even
  outside that city. Choose Tokyo for a Tokyo itinerary; imported custom places
  do not become city-wide public catalog entries. Pins are marked approximate,
  not geocoder-verified. This preserves the existing custom-pin behavior.
- Exact coordinate pairs and case-insensitive names reuse active custom places
  in the same owner scope and organizing city. Existing place details are kept.
  Repeated membership in one layer is skipped. Cross-scope places are never reused.
  This is conservative matching, not fuzzy business identification.
- Google place matching: a KML export has no place IDs, so on commit each
  selected marker gets one IDs-only Places Text Search (`places.id` field mask)
  for its name, restricted to a box about 200 m around its own coordinates. A hit
  is stored only as `custom_place.google_place_id`; the pin, name and note stay as
  imported, so the marker keeps its pin without the 30-day coordinate cache. The
  map detail then opens that place in Google Maps and loads its Google card only
  on request. Misses, provider errors, a missing key, or more than 2,000 markers
  per member per 24 hours leave markers unmatched. Importing the same marker
  again links an earlier unmatched copy. Matching runs before the transaction,
  with six lookups at a time, and is skipped for a replayed request.
- Preview estimates may change if another editor changes data before saving.
  Saving rechecks permissions, revisions, capacity and duplicates transactionally.
- A request ID plus payload digest protects retries, including after an uncertain
  network response. A deliberate new import may create new layers while reusing
  places; it is not an update/sync operation.
- Maximum compressed/upload size and expanded KML size: 5 MiB each. At most
  1,000 placemarks, 100 source layers and 200 ZIP entries. The existing cap of
  1,000 custom places per owner scope is enforced atomically.
- Only named Point placemarks with finite, in-range coordinates are imported.
  Missing coordinates/names, routes and polygons are skipped. Network links and
  ground overlays are counted as skipped and never fetched. Photos and styles are
  ignored. Descriptions are plain text (up to 2,000 characters), addresses up to
  300, marker names up to 160, and layer titles up to 80.
- XML DTDs/entities are rejected. Built-in XML escapes are decoded. XML nesting,
  ZIP inflation, HTTP size, DNS time, request time and per-user requests are bounded.
  Downloads use a fixed Google HTTPS origin, pin validated public IPv4 addresses,
  and reject redirects. No embedded URLs or files are fetched/executed.
- Source map links are canonicalized, stripping tracking parameters, and retained
  in layer/collection metadata and item notes. File imports carry a KML/KMZ source
  note. No source text or coordinates are recorded in analytics or retry receipts.

## API and storage

All endpoints are authenticated POSTs under `/api/v1/map-imports/`:

| Action    | Input                                | Result                                                                           |
| --------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| `preview` | `{url}` or `{file}` (base64 KML/KMZ) | Parsed document with source layers, markers and skipped count; no content writes |
| `review`  | Import request                       | Selected marker count and estimated new/reused places; no content writes         |
| `commit`  | Import request                       | `{collectionId,layers,added,reused,skipped,matched}`                             |

The request schema is `packages/shared/src/map-import.ts`: `permission:true`,
`requestId`, parsed `document`, selected marker IDs, destination `mode`, `title`,
`city`, optional `groupId`, or existing `layerId` and `revision`.
Submitted documents remain untrusted and are validated again on the server.

Migration `0028_flippant_sheva_callister.sql` adds `layer_collection`,
`layer_collection_member`, and `map_import_receipt`. Apply with the normal migration
workflow before enabling the UI. Migration `0035_medical_gabe_jones.sql` adds the
nullable `custom_place.google_place_id`. Receipts retain only IDs, layer titles/slugs,
counts and a payload hash; they cascade when the account is deleted. There is
currently no automatic receipt retention period.

## Verification

Use a disposable migrated database with reference seeds:

```sh
pnpm exec vitest run tests/unit/map-import.test.ts tests/unit/map-import-download.test.ts
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/map-import.test.ts
pnpm exec playwright test tests/e2e/map-import.spec.ts
```

Tests use a synthetic permitted fixture and mocked network responses. A read-only
manual preview of the example shared map found 287 markers in six layers; it did
not save any of that map's content.
