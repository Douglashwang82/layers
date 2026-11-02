/**
 * Browser-side sticker marker pipeline: decode → (lasso → model refine) →
 * white band → 128 px transparent PNG. The photo never leaves the device;
 * only the finished sticker is uploaded (re-encoding also drops EXIF/GPS).
 */
import {
  type Mask,
  type Point,
  alphaMask,
  borderFor,
  circleMask,
  composeSticker,
  feather,
  maskBounds,
  orientConfidence,
  polygonCentroid,
  rasterizePolygon,
  refineWithLasso,
  shrinkToward,
} from "./sticker-math";

/** Longest side of the working image: enough detail for a 128 px pin, fast to segment. */
const workingSize = 640;
export const stickerSize = 128;
/** Pinned with the npm package; the model is Google's published Magic Touch. */
const mediapipeVersion = "0.10.21";
const wasmBase = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mediapipeVersion}/wasm`;
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite";

export type WorkingImage = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

/** Decodes a photo (EXIF orientation applied) into a downscaled working canvas. */
export async function loadWorkingImage(file: Blob): Promise<WorkingImage> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const scale = Math.min(
    1,
    workingSize / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  return { canvas, width, height, rgba };
}

type Segmenter = {
  segment: (
    image: HTMLCanvasElement,
    roi: { scribble: { x: number; y: number }[] },
    callback: (result: {
      confidenceMasks?: { getAsFloat32Array(): Float32Array; close(): void }[];
    }) => void,
  ) => void;
};
let segmenter: Promise<Segmenter> | null = null;

/** Loads MediaPipe's interactive segmenter once per page; failures retry next time. */
function loadSegmenter(): Promise<Segmenter> {
  segmenter ??= (async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
    return (await vision.InteractiveSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl },
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })) as unknown as Segmenter;
  })().catch((e) => {
    segmenter = null;
    throw e;
  });
  return segmenter;
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

export type CutResult = { mask: Mask; refined: boolean };

/**
 * The object the user circled: the model's segmentation, constrained to the
 * lasso, or the lasso shape itself when the model is unavailable or unsure.
 */
export async function cutOut(
  image: WorkingImage,
  lasso: Point[],
): Promise<CutResult> {
  const { width: w, height: h } = image;
  const lassoMask = rasterizePolygon(lasso, w, h);
  const fallback = { mask: feather(lassoMask, w, h), refined: false };
  try {
    const model = await withTimeout(loadSegmenter(), 20000);
    const c = polygonCentroid(lasso);
    // A rough circle around the object, shrunk, is a scribble over it.
    const step = Math.max(1, Math.floor(lasso.length / 16));
    const core = shrinkToward(
      lasso.filter((_, i) => i % step === 0),
      c,
      0.35,
    );
    const scribble = [c, ...core].map((p) => ({ x: p.x / w, y: p.y / h }));
    let confidence: Float32Array | null = null;
    model.segment(image.canvas, { scribble }, (result) => {
      const mask = result.confidenceMasks?.[0];
      // The mask is only valid inside the callback; copy it out.
      if (mask) confidence = new Float32Array(mask.getAsFloat32Array());
      result.confidenceMasks?.forEach((m) => m.close());
    });
    if (!confidence || (confidence as Float32Array).length !== w * h) {
      debug("no usable mask", (confidence as Float32Array | null)?.length);
      return fallback;
    }
    const oriented = orientConfidence(
      confidence,
      rasterizePolygon(core.length >= 3 ? core : lasso, w, h),
      lassoMask,
    );
    const margin = Math.round(Math.max(w, h) * 0.02);
    const refined = refineWithLasso(oriented, lassoMask, w, h, margin);
    if (!refined) debug("model found too little inside the outline");
    return refined ? { mask: feather(refined, w, h), refined: true } : fallback;
  } catch (e) {
    debug(
      "refinement unavailable",
      e instanceof Event
        ? `${e.type} ${(e.target as { src?: string } | null)?.src ?? ""}`
        : e,
    );
    return fallback;
  }
}

/** Why a cut fell back to the outline; development only. */
function debug(...args: unknown[]) {
  if (process.env.NODE_ENV !== "production")
    console.warn("[sticker]", ...args);
}

/** "Use whole image": an icon's own transparency, else a centered circle. */
export function wholeImageMask(image: WorkingImage): Mask {
  const { width: w, height: h } = image;
  return alphaMask(image.rgba, w, h) ?? circleMask(w, h);
}

/**
 * Renders the sticker (object + white band + soft shadow) onto a square
 * transparent canvas of `stickerSize` pixels.
 */
export function renderSticker(image: WorkingImage, mask: Mask) {
  const { width: w, height: h, rgba } = image;
  const box = maskBounds(mask, w, h, 0.5);
  if (!box) return null;
  const border = borderFor(box);
  const pad = border + 3;
  const cw = box.w + pad * 2,
    ch = box.h + pad * 2;
  // Crop (with transparent padding) so the band never runs off the edge.
  const cropRgba = new Uint8ClampedArray(cw * ch * 4);
  const cropMask = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const sx = x + box.x - pad,
        sy = y + box.y - pad;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const si = sy * w + sx,
        di = y * cw + x;
      cropMask[di] = mask[si];
      cropRgba.set(rgba.subarray(si * 4, si * 4 + 4), di * 4);
    }
  const sticker = composeSticker(cropRgba, cropMask, cw, ch, border);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cw;
  cropCanvas.height = ch;
  cropCanvas
    .getContext("2d")!
    .putImageData(new ImageData(sticker, cw, ch), 0, 0);
  const out = document.createElement("canvas");
  out.width = stickerSize;
  out.height = stickerSize;
  const ctx = out.getContext("2d")!;
  const room = stickerSize - 10;
  const scale = room / Math.max(cw, ch);
  const dw = cw * scale,
    dh = ch * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.drawImage(
    cropCanvas,
    (stickerSize - dw) / 2,
    (stickerSize - dh) / 2,
    dw,
    dh,
  );
  return out;
}

export function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode"))),
      "image/png",
    ),
  );
}
