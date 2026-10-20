# Jade Atlas map

The map home uses a flat, north-up Mercator basemap with a warm-gray land palette,
blue-gray water, muted parks and off-white roads. Mouse, touch and keyboard rotation
are disabled; pitch is constrained to zero. Road widths, geography, route shields,
attribution and language fallbacks are retained. Provider POI/transit labels are
hidden to give the active TaiwanHub layers visual priority.

Catalog places, events and content use small dots at every zoom, with clustering
and 44 px invisible hit regions. Selection uses a ring and localized label from
an unclustered source so selection remains visible at wider zooms. Type labels
and icons in the list complement marker colors. Minor road detail appears only
at closer zooms. The map home no longer mounts illustrated marker sprites or the
selected companion; shared artwork and companion components remain available.

The canvas fills the viewport behind floating controls. Results, layers and details
share an expandable floating panel; mobile uses a bottom sheet. Camera padding
accounts for that panel and the search controls. External search results retain
their hollow markers. A missing token or failed renderer forces the list visible.

The map does not change layer membership, item coordinates, permissions, filtering,
selection URLs or list fallback. Motion still respects the existing effects flag
and reduced-motion preference. No provider credentials or new dependencies are
required beyond the existing Mapbox setup.

Implementation: `apps/web/src/lib/map-appearance.ts`, `map-panel.ts`,
`apps/web/src/components/map/map-canvas.tsx` and `apps/web/src/app/map.css`.
