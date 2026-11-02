/**
 * Pure mask math for sticker markers: everything here works on plain typed
 * arrays (alpha in 0..1, row-major, width × height), so it is unit-testable
 * without a canvas. The browser-only steps live in `sticker-pipeline.ts`.
 */
export type Point = { x: number; y: number };
export type Mask = Float32Array;
export type Box = { x: number; y: number; w: number; h: number };

/** Even-odd scanline fill of a closed polygon (pixel centers), as a 0/1 mask. */
export function rasterizePolygon(points: Point[], w: number, h: number): Mask {
  const mask = new Float32Array(w * h);
  if (points.length < 3) return mask;
  const xs: number[] = [];
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j];
      if (a.y > cy !== b.y > cy)
        xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/** Area-weighted polygon centroid; falls back to the vertex mean when degenerate. */
export function polygonCentroid(points: Point[]): Point {
  let area = 0,
    cx = 0,
    cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    area += cross;
    cx += (points[j].x + points[i].x) * cross;
    cy += (points[j].y + points[i].y) * cross;
  }
  if (Math.abs(area) < 1e-6) {
    const n = points.length || 1;
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

/** The polygon scaled toward a point: a rough lasso becomes a scribble over the object. */
export function shrinkToward(points: Point[], c: Point, factor: number) {
  return points.map((p) => ({
    x: c.x + (p.x - c.x) * factor,
    y: c.y + (p.y - c.y) * factor,
  }));
}

/**
 * Approximate Euclidean distance (pixels) from every pixel to the nearest
 * pixel with mask ≥ 0.5, by a two-pass 3-4 chamfer transform. Inside pixels are 0.
 */
export function distanceOutside(mask: Mask, w: number, h: number) {
  const inf = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] >= 0.5 ? 0 : inf;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? inf : d[y * w + x];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i],
        at(x - 1, y) + 3,
        at(x, y - 1) + 3,
        at(x - 1, y - 1) + 4,
        at(x + 1, y - 1) + 4,
      );
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i],
        at(x + 1, y) + 3,
        at(x, y + 1) + 3,
        at(x + 1, y + 1) + 4,
        at(x - 1, y + 1) + 4,
      );
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i] / 3;
  return d;
}

/** Grows a mask by `radius` pixels (binary result). */
export function dilate(mask: Mask, w: number, h: number, radius: number) {
  const dist = distanceOutside(mask, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = dist[i] <= radius ? 1 : 0;
  return out;
}

export function maskArea(mask: Mask, threshold = 0.5) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] >= threshold) n++;
  return n;
}

/**
 * Keeps the model's object only where the user circled (with a small margin
 * for an edge drawn slightly inside the object). Returns null when the model
 * found almost nothing there, so the caller uses the lasso itself.
 */
export function refineWithLasso(
  model: Mask,
  lasso: Mask,
  w: number,
  h: number,
  margin: number,
  minCoverage = 0.05,
): Mask | null {
  const allowed = dilate(lasso, w, h, margin);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = allowed[i] ? model[i] : 0;
  const lassoArea = maskArea(lasso);
  if (!lassoArea || maskArea(out) < lassoArea * minCoverage) return null;
  return out;
}

/**
 * Model confidence masks can come back with either polarity. The object is
 * the side that scores higher on the user's scribble than outside the lasso.
 */
export function orientConfidence(
  confidence: Mask,
  scribble: Mask,
  lasso: Mask,
): Mask {
  let inSum = 0,
    inN = 0,
    outSum = 0,
    outN = 0;
  for (let i = 0; i < confidence.length; i++) {
    if (scribble[i] >= 0.5) {
      inSum += confidence[i];
      inN++;
    } else if (lasso[i] < 0.5) {
      outSum += confidence[i];
      outN++;
    }
  }
  const inside = inN ? inSum / inN : 1;
  const outside = outN ? outSum / outN : 0;
  if (inside >= outside) return confidence;
  const flipped = new Float32Array(confidence.length);
  for (let i = 0; i < flipped.length; i++) flipped[i] = 1 - confidence[i];
  return flipped;
}

/** A 3×3 box blur for a soft (anti-aliased) cut edge. */
export function feather(mask: Mask, w: number, h: number) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0,
        n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += mask[yy * w + xx];
          n++;
        }
      out[y * w + x] = sum / n;
    }
  return out;
}

/** Tight bounding box of mask ≥ threshold, or null for an empty mask. */
export function maskBounds(
  mask: Mask,
  w: number,
  h: number,
  threshold = 0.5,
): Box | null {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A filled circle inscribed in the image: the "use whole image" icon shape. */
export function circleMask(w: number, h: number): Mask {
  const mask = new Float32Array(w * h);
  const r = Math.min(w, h) / 2;
  const cx = w / 2,
    cy = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // One pixel of anti-aliasing at the rim.
      mask[y * w + x] = Math.max(0, Math.min(1, r - d + 0.5));
    }
  return mask;
}

/** The image's own alpha, when enough of it is transparent to be a cut-out already. */
export function alphaMask(rgba: Uint8ClampedArray, w: number, h: number) {
  const mask = new Float32Array(w * h);
  let clear = 0;
  for (let i = 0; i < w * h; i++) {
    mask[i] = rgba[i * 4 + 3] / 255;
    if (mask[i] < 0.5) clear++;
  }
  return clear >= w * h * 0.05 ? mask : null;
}

/**
 * The sticker: the cut-out object over a white band `border` pixels wide that
 * follows its edge, on a transparent background. Input and output are RGBA of
 * the same size; the caller pads the canvas so the band fits.
 */
export function composeSticker(
  rgba: Uint8ClampedArray,
  mask: Mask,
  w: number,
  h: number,
  border: number,
) {
  const dist = distanceOutside(mask, w, h);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // White band: opaque within `border`, a one-pixel soft outer edge.
    const band = Math.max(0, Math.min(1, border + 0.5 - dist[i]));
    const a = mask[i];
    // Object over white ("source-over"), then the union alpha.
    const alpha = a + band * (1 - a);
    const o = i * 4;
    if (alpha <= 0) continue;
    for (let c = 0; c < 3; c++)
      out[o + c] = Math.round((rgba[o + c] * a + 255 * band * (1 - a)) / alpha);
    out[o + 3] = Math.round(alpha * 255);
  }
  return out;
}

/** Border width (pixels) for a cut-out of this size: a sticker-like ~6%. */
export function borderFor(box: Box) {
  return Math.max(3, Math.round(Math.max(box.w, box.h) * 0.06));
}
