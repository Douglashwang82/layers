import { describe, expect, it } from "vitest";
import type { LayerAvailability } from "@/features/map/query";
import { groupByLayer, layerColor } from "@/components/map/layer-section";
import { orderLayers } from "@/lib/layer-labels";

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

describe("orderLayers", () => {
  const row = (slug: string, title = slug) => ({ slug, title });
  const library = [row("newest"), row("older")];

  it("gives the same order whichever layers are ticked", () => {
    const all = [row("older"), row("zebra"), row("newest"), row("apple")];
    const expected = ["newest", "older", "apple", "zebra"];
    expect(orderLayers(all, library).map((l) => l.slug)).toEqual(expected);
    expect(orderLayers([...all].reverse(), library).map((l) => l.slug)).toEqual(
      expected,
    );
  });

  it("keeps the applied subset in that order without changing its input", () => {
    const applied = [row("older"), row("newest")];
    expect(orderLayers(applied, library).map((l) => l.slug)).toEqual([
      "newest",
      "older",
    ]);
    expect(applied[0].slug).toBe("older");
  });

  it("breaks a title tie on the slug", () => {
    const tied = [row("b", "Same"), row("a", "Same")];
    expect(orderLayers(tied, []).map((l) => l.slug)).toEqual(["a", "b"]);
  });
});
