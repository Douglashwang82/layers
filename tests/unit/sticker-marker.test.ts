import { describe, expect, it } from "vitest";
import {
  alphaMask,
  borderFor,
  circleMask,
  composeSticker,
  dilate,
  distanceOutside,
  maskArea,
  maskBounds,
  orientConfidence,
  polygonCentroid,
  rasterizePolygon,
  refineWithLasso,
  shrinkToward,
} from "@/components/markers/sticker-math";
import {
  customPinId,
  pendingPinUrls,
  pinProperty,
  type PinStatus,
} from "@/lib/custom-pins";
import { unionItems } from "@taiwanhub/shared";

const square = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe("sticker mask math", () => {
  it("rasterizes a lasso polygon by pixel centers", () => {
    const mask = rasterizePolygon(square(2, 2, 6, 6), 10, 10);
    expect(maskArea(mask)).toBe(16);
    expect(mask[3 * 10 + 3]).toBe(1);
    expect(mask[0]).toBe(0);
    expect(maskBounds(mask, 10, 10)).toEqual({ x: 2, y: 2, w: 4, h: 4 });
  });

  it("ignores lassos with fewer than three points", () => {
    expect(
      maskArea(rasterizePolygon(square(0, 0, 4, 4).slice(0, 2), 5, 5)),
    ).toBe(0);
    expect(maskBounds(new Float32Array(25), 5, 5)).toBeNull();
  });

  it("finds the centroid and shrinks a lasso into a scribble", () => {
    const c = polygonCentroid(square(0, 0, 10, 10));
    expect(c.x).toBeCloseTo(5);
    expect(c.y).toBeCloseTo(5);
    expect(shrinkToward([{ x: 10, y: 0 }], c, 0.5)[0]).toEqual({
      x: 7.5,
      y: 2.5,
    });
  });

  it("measures approximate distance outside a mask and dilates by it", () => {
    const mask = new Float32Array(11 * 11);
    mask[5 * 11 + 5] = 1;
    const d = distanceOutside(mask, 11, 11);
    expect(d[5 * 11 + 5]).toBe(0);
    expect(d[5 * 11 + 8]).toBeCloseTo(3);
    expect(maskArea(dilate(mask, 11, 11, 2))).toBeGreaterThan(9);
    expect(dilate(mask, 11, 11, 2)[5 * 11 + 9]).toBe(0);
  });

  it("keeps the model's object only inside the circled area", () => {
    const w = 20,
      h = 20;
    const lasso = rasterizePolygon(square(2, 2, 10, 10), w, h);
    const model = new Float32Array(w * h).fill(1); // model says "everything"
    const refined = refineWithLasso(model, lasso, w, h, 1)!;
    expect(refined).not.toBeNull();
    expect(refined[15 * w + 15]).toBe(0);
    expect(refined[5 * w + 5]).toBe(1);
  });

  it("falls back to the lasso when the model finds almost nothing there", () => {
    const w = 20,
      h = 20;
    const lasso = rasterizePolygon(square(2, 2, 12, 12), w, h);
    const model = new Float32Array(w * h);
    model[5 * w + 5] = 1;
    expect(refineWithLasso(model, lasso, w, h, 1)).toBeNull();
  });

  it("flips an inverted confidence mask so the scribble is the object", () => {
    const w = 10,
      h = 10;
    const lasso = rasterizePolygon(square(2, 2, 8, 8), w, h);
    const scribble = rasterizePolygon(square(4, 4, 6, 6), w, h);
    const inverted = new Float32Array(w * h).map((_, i) =>
      scribble[i] ? 0 : 1,
    );
    const oriented = orientConfidence(inverted, scribble, lasso);
    expect(oriented[5 * w + 5]).toBe(1);
    expect(oriented[0]).toBe(0);
    const upright = new Float32Array(scribble);
    expect(orientConfidence(upright, scribble, lasso)).toBe(upright);
  });

  it("adds an opaque white band around the object and keeps its pixels", () => {
    const w = 16,
      h = 16;
    const mask = rasterizePolygon(square(6, 6, 10, 10), w, h);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([200, 10, 10, 255], i * 4);
    const out = composeSticker(rgba, mask, w, h, 2);
    const px = (x: number, y: number) =>
      Array.from(out.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
    expect(px(7, 7)).toEqual([200, 10, 10, 255]); // object
    expect(px(10, 7)).toEqual([255, 255, 255, 255]); // band, 1px outside
    expect(px(0, 0)[3]).toBe(0); // background stays transparent
  });

  it("sizes the border to the cut-out and builds whole-image masks", () => {
    expect(borderFor({ x: 0, y: 0, w: 20, h: 10 })).toBe(3);
    expect(borderFor({ x: 0, y: 0, w: 200, h: 100 })).toBe(12);
    const circle = circleMask(10, 10);
    expect(circle[5 * 10 + 5]).toBe(1);
    expect(circle[0]).toBe(0);
    const opaque = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    expect(alphaMask(opaque, 4, 4)).toBeNull();
    const icon = new Uint8ClampedArray(opaque);
    icon[3] = 0; // one of 16 pixels transparent (>5%)
    expect(alphaMask(icon, 4, 4)?.[0]).toBe(0);
  });
});

describe("custom pins on the map", () => {
  it("only tags a feature once its image is registered", () => {
    const url = "https://cdn.example.com/a.png";
    const status = new Map<string, PinStatus>([[url, "loading"]]);
    expect(pinProperty(url, status)).toEqual({});
    status.set(url, "ready");
    expect(pinProperty(url, status)).toEqual({ pin: customPinId(url) });
    status.set(url, "failed");
    expect(pinProperty(url, status)).toEqual({});
    expect(pinProperty(null, status)).toEqual({});
  });

  it("requests each new marker URL once", () => {
    const status = new Map<string, PinStatus>([["/uploads/old.png", "ready"]]);
    expect(
      pendingPinUrls(
        ["/uploads/a.png", null, "/uploads/a.png", "/uploads/old.png"],
        status,
      ),
    ).toEqual(["/uploads/a.png"]);
  });

  it("gives distinct URLs distinct image ids", () => {
    expect(customPinId("/uploads/a.png")).not.toBe(
      customPinId("/uploads/b.png"),
    );
    expect(customPinId("/uploads/a.png")).toBe(customPinId("/uploads/a.png"));
  });

  it("keeps the first layer's marker when merging an item across layers", () => {
    const merged = unionItems([
      [{ key: "place:1", layers: ["a"] }],
      [{ key: "place:1", layers: ["b"], markerImageUrl: "/uploads/b.png" }],
      [{ key: "place:1", layers: ["c"], markerImageUrl: "/uploads/c.png" }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].layers).toEqual(["a", "b", "c"]);
    expect(merged[0].markerImageUrl).toBe("/uploads/b.png");
  });
});
