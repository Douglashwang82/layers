# Jade Atlas dark mode (map view)

Status: design proposal. Nothing here is implemented. It extends
[jade-atlas-map.md](jade-atlas-map.md) and keeps its structure: a flat, quiet,
neutral basemap, with app markers, text and controls carrying the stronger values.

## Scope and trigger

- **Map home only** (`.map-workspace`). The rest of the site stays light-only
  (`globals.css` sets `color-scheme: light`). Because the map shell already
  re-themes through `body:has(.map-workspace)` tokens, dark mode is a second
  token set on that same selector, so no other page changes.
- **Trigger: OS preference by default, with a user override.** Resolve a
  `mapTheme` of `system | light | dark`, stored in `localStorage` (key follows the
  existing `taiwanhub` prefix convention) and exposed as `data-map-theme` on
  `.map-workspace`. The override is a three-state control in the existing profile
  menu (`.map-profile-menu`), not a new floating button. `system` follows
  `prefers-color-scheme` live. No server or database state; it is a device preference.
- Everything is keyed off one resolved value so CSS, the Mapbox style, and
  canvas-drawn glyphs cannot disagree.

## Basemap

Switch the provider style to `mapbox://styles/mapbox/dark-v11` in dark mode and
restyle it with the same pipeline as `applyJadeAtlas`, parameterised by palette
(`jadePalette` becomes `atlasPalettes.light | .dark`). Do not use a CSS filter or
`invert()`; it would also invert markers and photos.

Changing style calls `map.setStyle`, which drops app sources and layers. The
canvas must re-run its layer setup (sources `items`, `selected-item`,
`hover-item`, `places-extra`, all layers, and glyph images) after the new style's
`style.load`. Refactor the body of the `load` handler into `installAppLayers(map)`
and call it for both the first load and theme switches; preserve camera, selection
and hover state, which already live in React refs. Avoid a flash by changing the
container background to the dark land color first.

| Token    | Light     | Dark      | Note                                                               |
| -------- | --------- | --------- | ------------------------------------------------------------------ |
| land     | `#f3f3f3` | `#1b1c1e` | also the label halo                                                |
| park     | `#e6e6e6` | `#232528` | slightly lighter than land, as in light mode                       |
| water    | `#d4d4d4` | `#12202c` | blue-gray so it separates from land (1.11:1 neutral was too close) |
| building | `#ececec` | `#232427` |                                                                    |
| road     | `#ffffff` | `#3f4247` | lighter than land: roads read as light lines                       |
| roadEdge | `#d9d9d9` | `#141517` |                                                                    |
| boundary | `#cccccc` | `#505358` | 2.2:1 is fine for a non-text divider                               |
| label    | `#5c5c5c` | `#a9acb1` | 7.5:1 on land                                                      |
| surface  | `#ffffff` | `#26272a` | clusters, halos, label halo for selected text                      |
| ink      | `#111111` | `#f2f2f2` | cluster counts, selected label, outlines                           |

Keep the zoom-gated detail rules, POI/transit hiding, extrusion hiding and
localized `text-field` handling unchanged. The existing layer-id regexes target
`light-v11` ids; verify they match `dark-v11` (the Streets-derived ids are shared,
but confirm `landuse`, `water`, `building` and `admin-*` in the loaded style, and
log unmatched ids in development rather than failing).

## Markers

Light-mode pins are muted mid-tones with a white stroke, a dark under-ring and
white glyphs. On a dark land those mid-tones sink, and white glyphs on lighter
fills lose contrast, so dark mode inverts the construction:

- Lighter tints of the same hue, so kind recognition carries over.
- Dark stroke (`#15161a`) and a pale under-ring (`#ffffff` at 0.35 opacity).
- **Dark glyphs** (`#15161a`) rasterised from the same canvas paths.
- Hover/selection: pale outline (`#f2f2f2`) instead of `#111111`.

| Kind      | Light     | Dark      | Dot vs land | Glyph vs dot |
| --------- | --------- | --------- | ----------- | ------------ |
| food      | `#A66B4F` | `#D9937A` | 6.8:1       | 7.2:1        |
| retail    | `#5C7893` | `#8FB0CC` | 7.5:1       | 8.0:1        |
| park      | `#617D59` | `#8FB487` | 7.4:1       | 7.8:1        |
| culture   | `#867098` | `#B7A0CC` | 7.2:1       | 7.7:1        |
| community | `#4F837D` | `#84BDB5` | 8.1:1       | 8.6:1        |
| event     | `#B15F73` | `#DE90A3` | 7.0:1       | 7.4:1        |
| info      | `#81796E` | `#B3AB9F` | 7.5:1       | 8.0:1        |

All pass the 3:1 non-text threshold with room to spare. Ratios are computed
against the dark land color. Implement as `markerColors.light/dark` and make
`markerGlyphImage(kind, theme)` choose its stroke color; the glyph images must be
re-registered on a theme change (`map.hasImage` / `removeImage` then `addImage`).
The map key (`marker-legend.tsx`) reads the same table so legend and map match.

Unchanged semantics: search results stay hollow, saved/layer external places stay
filled, clusters keep a ring, and kind is still repeated by icon and list label,
so color is never the only cue.

## Floating chrome

Override the same tokens that `body:has(.map-workspace)` already sets, under
`.map-workspace[data-map-theme="dark"]` (and the system-resolved equivalent):

| Token                 | Light     | Dark      |
| --------------------- | --------- | --------- |
| `--th-canvas`         | `#f3f3f3` | `#1b1c1e` |
| `--th-surface`        | `#ffffff` | `#26272a` |
| `--th-surface-soft`   | `#f6f6f6` | `#2e3033` |
| `--th-text`           | `#111111` | `#f2f2f2` |
| `--th-muted`          | `#5c5c5c` | `#a3a6ab` |
| `--th-brand-text`     | `#111111` | `#f2f2f2` |
| `--th-divider`        | `#e4e4e4` | `#3a3c40` |
| `--th-control-border` | `#808080` | `#8d9096` |
| `--th-map-place`      | `#111111` | `#f2f2f2` |
| `--th-map-event`      | `#5c5c5c` | `#b0b0b0` |
| `--th-map-content`    | `#8a8a8a` | `#8a8a8a` |

Text on surface: ink 13.3:1, muted 6.1:1. `--th-focus` (`#2855d9`) is too dark on
`#26272a`; use `#8fb0ff` in dark and keep focus visibly distinct from selection.

Component changes beyond tokens (the hard-coded values in `map.css`):

- **Shadows** do not read on dark. Replace `--th-float-shadow` with a stronger
  shadow plus a 1 px inner `rgb(255 255 255 / 8%)` border so floating panels still
  lift off the map.
- **Hard-coded colors** to tokenize: `#ffffff` text on `.map-filters .segmented
button.on` (line ~135, the selected fill becomes the pale ink with dark text),
  the `#e6e6e6`/`#111111` disabled and count-pill pair (~165), `#f3f3f3` canvas
  fallback (~259), the `#2b2b2b`/`#ffffff` list-toggle pair (~349), the skeleton
  shimmer `rgb(255 255 255 / 0.6)` (~304, use a low-alpha white on the dark
  surface), and the `.map-tooltip` `#111111` border (~1750).
- **Mapbox controls** (`.mapboxgl-ctrl-group`, attribution) get dark surfaces;
  their icons are raster/SVG background images, so apply `filter: invert(1)` to
  the control _icons only_ (`.mapboxgl-ctrl-group button .mapboxgl-ctrl-icon`),
  never the map canvas.
- **Result thumbnails** are photos; leave them unfiltered, add a faint
  `outline: 1px solid rgb(255 255 255 / 10%)` so pale images do not bleed into the
  panel. Skeleton placeholders use `--th-surface-soft`.
- **Google Places UI Kit** (`.provider-slot`) currently forces `color-scheme:
light`. In dark mode set `color-scheme: dark` on the slot so the third-party
  element matches; if it cannot, keep the slot as a light card with a divider
  rather than a half-themed widget. Verify against the pinned UI Kit version.
- Set `color-scheme: dark` on `.map-workspace` so scrollbars and form controls
  follow, and update `<meta name="theme-color">` while the map is mounted.

## Accessibility

- Contrast: text >= 4.5:1, UI/markers >= 3:1, as tabulated; verify the final
  values with the existing contrast tooling, not by eye.
- Honour `prefers-reduced-motion` for the theme cross-fade (none when reduced).
- The theme control is a labelled radiogroup with visible focus; copy lives in the
  EN/zh-TW dictionary (`mapThemeSystem/Light/Dark` and a group label).
- No information is carried by theme alone; demo labels and the unavailable
  fallback (missing token or failed renderer) render correctly in both themes.

## Implementation plan

1. `map-appearance.ts`: `atlasPalettes`, `applyAtlas(map, locale, theme)`;
   unit-test palette contrast with the same ratios as above.
2. `marker-presentation.ts` and `marker-legend.tsx`: per-theme colors and glyphs.
3. `map-canvas.tsx`: extract `installAppLayers`, choose style by theme,
   re-install on `style.load`, preserve selection/hover/camera.
4. `map.css`: dark token block, tokenized hard-coded colors, control icon invert.
5. Theme resolution hook plus profile-menu control and dictionary strings.
6. Tests: unit for palette/theme resolution; Playwright with
   `colorScheme: "dark"` asserting `data-map-theme`, that markers and selection
   survive a live switch, and that list fallback works without a token.

## Open questions

- Whether the override should also apply to non-map pages later. This design
  deliberately does not require it.
- Whether to ship `dark-v11` as is or a custom Studio style; the restyle
  pipeline works for both, and a custom style would reduce runtime restyling.
