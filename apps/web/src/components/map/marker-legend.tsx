import { markerKinds } from "@taiwanhub/shared";
import type { Copy } from "@/lib/dictionary";
import { markerLabel } from "@/lib/marker-presentation";

/** Explains pin colors only; it never filters. Each entry also has a text label. */
export function MarkerLegend({ t }: { t: Copy }) {
  return (
    <details className="map-key">
      <summary>{t.markerLegend}</summary>
      <ul>
        {markerKinds.map((kind) => (
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
