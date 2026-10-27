import { describe, expect, it } from "vitest";
import type { LayerAvailability } from "@/features/map/query";
import { groupByLayer, layerColor } from "@/components/map/layer-section";

const layer = (slug: string, status = "ok") =>
  ({ slug, status }) as unknown as LayerAvailability;

describe("groupByLayer", () => {
  const rows = [
    { id: "a", layers: ["ramen"] },
    { id: "b", layers: ["ramen", "cafe"] },
    { id: "c", layers: ["other"] },
  ];
  it("lists a multi-layer row under each layer and keeps layer order", () => {
    const { groups, rest } = groupByLayer(rows, [
      layer("cafe"),
      layer("ramen"),
    ]);
    expect(groups.map((g) => [g.layer.slug, g.rows.map((r) => r.id)])).toEqual([
      ["cafe", ["b"]],
      ["ramen", ["a", "b"]],
    ]);
    expect(rest.map((r) => r.id)).toEqual(["c"]);
  });
  it("skips unavailable layers and empty groups", () => {
    const { groups, rest } = groupByLayer(rows, [
      layer("ramen", "unavailable"),
      layer("empty"),
    ]);
    expect(groups).toEqual([]);
    expect(rest).toHaveLength(3);
  });
  it("derives a stable color per slug", () => {
    expect(layerColor("ramen")).toBe(layerColor("ramen"));
  });
});
