import { describe, expect, it } from "vitest";
import { layerColor } from "@/components/map/layer-section";
import { orderLayers } from "@/lib/layer-labels";

describe("layerColor", () => {
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
