import { describe, expect, it } from "vitest";
import {
  accountPanelHref,
  readAccountPanel,
  withoutAccountPanel,
} from "@/lib/account-panel";
import { withoutLayerPanel } from "@/lib/layer-workspace";
import { withoutTripPanel } from "@/lib/trip-panel";

describe("account sidebar URL state", () => {
  it("opens on a bare map", () => {
    expect(accountPanelHref()).toBe("/?account=1");
    expect(readAccountPanel(new URLSearchParams("account=1"))).toBe(true);
    expect(readAccountPanel(new URLSearchParams("layers=a"))).toBe(false);
  });

  it("keeps map, layer and trip state when opening and closing", () => {
    const current = "city=houston&layers=a,b&layerPanel=detail&layer=a&trip=t1";
    const open = accountPanelHref("?" + current);
    const params = new URLSearchParams(open.split("?")[1]);
    expect(params.get("account")).toBe("1");
    expect(params.get("layers")).toBe("a,b");
    expect(params.get("layerPanel")).toBe("detail");
    expect(params.get("trip")).toBe("t1");
    expect(withoutAccountPanel(open.split("?")[1])).toBe(
      "/?" + new URLSearchParams(current).toString(),
    );
  });

  it("closes to the bare map path", () => {
    expect(withoutAccountPanel("account=1")).toBe("/");
  });

  it("survives leaving layer and trip screens", () => {
    expect(withoutLayerPanel("layerPanel=library&account=1")).toBe(
      "/?account=1",
    );
    expect(withoutTripPanel("tripPanel=list&account=1")).toBe("/?account=1");
  });
});
