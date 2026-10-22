import { markerKinds, type MarkerKind } from "@taiwanhub/shared";
import type { Copy } from "@/lib/dictionary";
import { markerLabel } from "@/lib/marker-presentation";

/** Explains pin colors only; it never filters. Each entry also has a text label. */
export function MarkerLegend({
  t,
  kinds = markerKinds,
}: {
  t: Copy;
  /** The kinds this map can show (the map MVP uses the five Google place kinds). */
  kinds?: readonly MarkerKind[];
}) {
  return (
    <details className="map-key">
      <summary>{t.markerLegend}</summary>
      <ul>
        {kinds.map((kind) => (
          <li key={kind}>
            <span
              className="key-dot"
              style={{ background: `var(--marker-${kind})` }}
              aria-hidden="true"
            />
            {markerLabel(kind, t)}
          </li>
        ))}
      </ul>
    </details>
  );
}
