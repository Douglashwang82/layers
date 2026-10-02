# Jade Atlas map

The map home uses a flat, north-up Mercator basemap with a pale jade land palette,
blue-gray water, muted parks and white roads. Mouse, touch and keyboard rotation
are disabled; pitch is constrained to zero. Road widths, geography, route shields,
attribution and language fallbacks are retained. Provider POI/transit labels are
hidden to give the active TaiwanHub layers visual priority.

At neighborhood zoom (12+), catalog places, events and content use small fixed
three-quarter-view storefront, calendar and document illustrations. These are
code-owned SVGs rasterized once per type into the Mapbox sprite atlas, not extra
live 3D scenes. They remain upright and use a shared ground anchor. Places use a
generic storefront so groceries, cafes and other place categories are not
misrepresented as restaurants. Category geometry complements color.

At wider zooms and when illustrations collide or cannot load, coordinate dots and
clusters remain usable. Each catalog dot has a 44 px invisible hit region; visible
illustrations also open their item. The existing real-geometry selected companion
remains the primary selected-state decoration, including for external results and
items hidden by clustering. External search results retain their hollow markers.

The map does not change layer membership, item coordinates, permissions, filtering,
selection URLs or list fallback. Motion still respects the existing effects flag
and reduced-motion preference. No provider credentials or new dependencies are
required beyond the existing Mapbox setup.

Implementation: `apps/web/src/lib/map-appearance.ts`, `map-marker-art.ts`,
`apps/web/src/components/map/map-canvas.tsx` and `apps/web/src/app/map.css`.
