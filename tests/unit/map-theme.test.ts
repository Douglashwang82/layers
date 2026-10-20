import { describe, expect, it, vi } from "vitest";
import type { LayerSpecification, Map as MapboxMap } from "mapbox-gl";
import { markerKinds } from "@taiwanhub/shared";
import {
  applyJadeAtlas,
  atlasPalettes,
  atlasStyles,
  jadeDarkPalette,
} from "@/lib/map-appearance";
import {
  markerChrome,
  markerCssVars,
  markerPalettes,
} from "@/lib/marker-presentation";
import { parseMapThemePreference, resolveMapTheme } from "@/lib/map-theme";

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe("map theme preference", () => {
  it("defaults unknown values to the system theme", () => {
    expect(parseMapThemePreference(null)).toBe("system");
    expect(parseMapThemePreference("sepia")).toBe("system");
    expect(parseMapThemePreference("dark")).toBe("dark");
    expect(parseMapThemePreference("light")).toBe("light");
  });

  it("resolves system from the OS and lets an override win", () => {
    expect(resolveMapTheme("system", true)).toBe("dark");
    expect(resolveMapTheme("system", false)).toBe("light");
    expect(resolveMapTheme("light", true)).toBe("light");
    expect(resolveMapTheme("dark", false)).toBe("dark");
  });
});

describe("dark atlas", () => {
  it("selects a dark provider style and palette", () => {
    expect(atlasStyles.dark).toContain("dark-v11");
    expect(atlasPalettes.dark).toBe(jadeDarkPalette);
  });

  it("restyles the basemap with the dark palette", () => {
    const layers: LayerSpecification[] = [
      { id: "land", type: "background" },
      { id: "water", type: "fill", source: "base" },
      { id: "road-primary", type: "line", source: "base" },
    ];
    const map = {
      getStyle: () => ({ layers }),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
      setLayerZoomRange: vi.fn(),
    };
    applyJadeAtlas(map as unknown as MapboxMap, "en", "dark");
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "land",
      "background-color",
      jadeDarkPalette.land,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "road-primary",
      "line-color",
      jadeDarkPalette.road,
    );
  });

  it("keeps text and markers legible on the dark land", () => {
    const { land, surface, label, ink } = jadeDarkPalette;
    expect(contrast(label, land)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
    for (const kind of markerKinds) {
      const dot = markerPalettes.dark[kind];
      expect(contrast(dot, land)).toBeGreaterThanOrEqual(3);
      expect(contrast(markerChrome.dark.glyph, dot)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("exposes every marker kind as a CSS variable per theme", () => {
    for (const theme of ["light", "dark"] as const) {
      const vars = markerCssVars(theme);
      for (const kind of markerKinds)
        expect(vars[`--marker-${kind}`]).toBe(markerPalettes[theme][kind]);
    }
  });
});
