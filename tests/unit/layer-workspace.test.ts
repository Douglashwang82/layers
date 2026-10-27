import { describe, expect, it } from "vitest";
import {
  layerWorkspaceHref,
  readLayerPanel,
  withoutLayerPanel,
} from "../../apps/web/src/lib/layer-workspace";

describe("layer navigation within the map", () => {
  it("opens details without changing visibility, selection or map filters", () => {
    const href = layerWorkspaceHref(
      "/layers/weekend",
      "city=houston&layers=food,parks&item=place:123&types=place&layerPanel=library&layerQ=tea",
    );
    const params = new URL(href, "https://local.invalid").searchParams;
    expect(params.get("layers")).toBe("food,parks");
    expect(params.get("item")).toBe("place:123");
    expect(params.get("types")).toBe("place");
    expect(params.get("city")).toBe("houston");
    expect(params.get("layerQ")).toBeNull();
    expect(params.get("layer")).toBe("weekend");
    expect(readLayerPanel(params)).toBe("detail");
  });
  it("separates layer search from map search and retains creation context", () => {
    const library = new URL(
      layerWorkspaceHref("/layers?tab=mine&q=tea", "q=noodles"),
      "https://local.invalid",
    );
    expect(library.searchParams.get("q")).toBe("noodles");
    expect(library.searchParams.get("layerQ")).toBe("tea");
    const created = new URL(
      layerWorkspaceHref(
        "/layers/new?group=abc&blank=1&add=place%3A123&next=%2Fsaved",
      ),
      "https://local.invalid",
    );
    expect(Object.fromEntries(created.searchParams)).toMatchObject({
      layerPanel: "new",
      group: "abc",
      blank: "1",
      add: "place:123",
      next: "/saved",
    });
  });
  it("supports the content editor and closes only the layer panel", () => {
    const href = layerWorkspaceHref(
      "/layers/weekend/edit#add-items",
      "layers=none&view=list",
    );
    expect(
      new URL(href, "https://local.invalid").searchParams.get("layerPanel"),
    ).toBe("contents");
    expect(withoutLayerPanel(href.split("?")[1])).toBe(
      "/?layers=none&view=list",
    );
    expect(readLayerPanel(new URLSearchParams("layerPanel=bogus"))).toBeNull();
  });
  it("never rewrites external or unrelated links", () => {
    for (const href of [
      "https://example.com/layers/foo",
      "//example.com/layers/foo",
      "/groups/team",
      "/sign-in?next=%2Flayers",
    ])
      expect(layerWorkspaceHref(href)).toBe(href);
  });
});
