"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ImagePlus, RotateCcw, Scan, X } from "lucide-react";
import { api } from "@/components/actions";
import { type Copy, format } from "@/lib/dictionary";
import type { Point } from "./sticker-math";
import {
  type WorkingImage,
  canvasToPng,
  cutOut,
  loadWorkingImage,
  renderSticker,
  wholeImageMask,
} from "./sticker-pipeline";

const maxUploadBytes = 5_000_000;
const acceptedTypes = ["image/png", "image/jpeg", "image/webp"];

type Step =
  | { kind: "pick" }
  | { kind: "draw" }
  | { kind: "cutting" }
  | { kind: "preview"; url: string; blob: Blob; refined: boolean | null };

/** Polygon area (shoelace), in working-image pixels. */
function area(points: Point[]) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++)
    sum += points[j].x * points[i].y - points[i].x * points[j].y;
  return Math.abs(sum) / 2;
}

/**
 * The custom marker control for one item in one layer: the current sticker,
 * and an editor that cuts an object out of a photo (or uses a whole icon),
 * adds the white sticker band and saves it as this item's map pin.
 */
export function LayerItemMarker({
  layerId,
  itemId,
  layerTitle,
  current,
  t,
}: {
  layerId: string;
  itemId: string;
  layerTitle: string;
  current: string | null;
  t: Copy;
}) {
  const [marker, setMarker] = useState(current);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "status" | "alert";
    text: string;
  } | null>(null);
  useEffect(() => setMarker(current), [current]);
  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      await api(`layers/${layerId}/items/${itemId}/marker`, "PATCH", {
        imageId: null,
      });
      setMarker(null);
      setMessage({ tone: "status", text: t.markerRemoved });
      notifyChanged();
    } catch (e) {
      setMessage({ tone: "alert", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="layer-item-marker">
      <div className="layer-item-marker-row">
        {marker && (
          <img
            className="layer-item-marker-thumb"
            src={marker}
            alt={t.markerCurrent}
            width={40}
            height={40}
          />
        )}
        <button
          type="button"
          className="button secondary small"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
        >
          <ImagePlus size={14} aria-hidden="true" />
          {marker ? t.markerChange : t.markerCustom}
        </button>
        {marker && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={remove}
          >
            {t.markerRemove}
          </button>
        )}
      </div>
      {message && (
        <p className="fine-print" role={message.tone}>
          {message.text}
        </p>
      )}
      {open && (
        <MarkerEditor
          layerId={layerId}
          itemId={itemId}
          help={format(t.markerHelp, { layer: layerTitle })}
          t={t}
          onClose={() => setOpen(false)}
          onSaved={(url) => {
            setMarker(url);
            setOpen(false);
            setMessage({ tone: "status", text: t.markerSaved });
            notifyChanged();
          }}
        />
      )}
    </div>
  );
}

/** The map and the layer item lists refetch after a marker change. */
function notifyChanged() {
  window.dispatchEvent(new Event("layer:item-reviews"));
}

function MarkerEditor({
  layerId,
  itemId,
  help,
  t,
  onClose,
  onSaved,
}: {
  layerId: string;
  itemId: string;
  help: string;
  t: Copy;
  onClose: () => void;
  onSaved: (url: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [image, setImage] = useState<WorkingImage | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [path, setPath] = useState<Point[]>([]);
  const drawing = useRef(false);
  const pathRef = useRef<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);
  useEffect(
    () => () => {
      if (step.kind === "preview") URL.revokeObjectURL(step.url);
    },
    [step],
  );

  async function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!acceptedTypes.includes(file.type) || file.size > maxUploadBytes * 4) {
      setError(t.markerBadFile);
      return;
    }
    try {
      const working = await loadWorkingImage(file);
      setImage(working);
      setPhotoUrl(working.canvas.toDataURL("image/jpeg", 0.9));
      setPath([]);
      setStep({ kind: "draw" });
    } catch {
      setError(t.markerUnreadable);
    }
  }

  async function finish(mask: Float32Array, refined: boolean | null) {
    if (!image) return;
    const canvas = renderSticker(image, mask);
    if (!canvas) {
      setError(t.markerTooSmall);
      setStep({ kind: "draw" });
      return;
    }
    const blob = await canvasToPng(canvas);
    setStep({
      kind: "preview",
      url: URL.createObjectURL(blob),
      blob,
      refined,
    });
  }

  async function cut(points: Point[]) {
    if (!image) return;
    if (
      points.length < 3 ||
      area(points) < image.width * image.height * 0.005
    ) {
      setError(t.markerTooSmall);
      setPath([]);
      return;
    }
    setError(null);
    setStep({ kind: "cutting" });
    const result = await cutOut(image, points);
    await finish(result.mask, result.refined);
  }

  function useWhole() {
    if (!image) return;
    setError(null);
    setPath([]);
    void finish(wholeImageMask(image), null);
  }

  function toImage(e: PointerEvent<SVGSVGElement>): Point | null {
    if (!image) return null;
    const box = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * image.width,
      y: ((e.clientY - box.top) / box.height) * image.height,
    };
  }

  async function save() {
    if (step.kind !== "preview") return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("image", step.blob, "marker.png");
      const response = await fetch("/api/v1/images", {
        method: "POST",
        body: form,
      });
      const uploaded = await response.json();
      if (!response.ok)
        throw new Error(uploaded.error?.message ?? t.markerBadFile);
      const result = (await api(
        `layers/${layerId}/items/${itemId}/marker`,
        "PATCH",
        { imageId: uploaded.data.id },
      )) as { markerImageUrl: string };
      onSaved(result.markerImageUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const drawn = path.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <dialog
      ref={dialog}
      className="marker-editor"
      aria-labelledby="marker-editor-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="marker-editor-head">
        <h2 id="marker-editor-title">{t.markerCustom}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t.close}
          onClick={() => dialog.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="muted">{help}</p>
      <label className="button secondary marker-editor-file">
        <ImagePlus size={16} aria-hidden="true" />
        {t.markerChoosePhoto}
        <input
          type="file"
          accept={acceptedTypes.join(",")}
          className="sr-only"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </label>
      {image &&
        photoUrl &&
        (step.kind === "draw" || step.kind === "cutting") && (
          <>
            <p className="fine-print">{t.markerCircleHint}</p>
            <div
              className="marker-editor-stage"
              style={{ aspectRatio: `${image.width} / ${image.height}` }}
            >
              <img src={photoUrl} alt="" />
              <svg
                role="img"
                aria-label={t.markerCanvasLabel}
                viewBox={`0 0 ${image.width} ${image.height}`}
                preserveAspectRatio="none"
                onPointerDown={(e) => {
                  if (step.kind !== "draw") return;
                  const p = toImage(e);
                  if (!p) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drawing.current = true;
                  setError(null);
                  pathRef.current = [p];
                  setPath([p]);
                }}
                onPointerMove={(e) => {
                  if (!drawing.current) return;
                  const p = toImage(e);
                  if (!p) return;
                  const prev = pathRef.current;
                  const last = prev[prev.length - 1];
                  // Skip sub-pixel moves; the outline only needs its shape.
                  if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2)
                    return;
                  pathRef.current = [...prev, p];
                  setPath(pathRef.current);
                }}
                onPointerUp={() => {
                  if (!drawing.current) return;
                  drawing.current = false;
                  void cut(pathRef.current);
                }}
                onPointerCancel={() => {
                  drawing.current = false;
                  setPath([]);
                }}
              >
                {path.length > 1 && (
                  <polygon
                    points={drawn}
                    className="marker-editor-lasso"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            </div>
          </>
        )}
      {step.kind === "cutting" && (
        <p className="fine-print" role="status" aria-live="polite">
          {t.markerCutting}
        </p>
      )}
      {step.kind === "preview" && (
        <figure className="marker-editor-preview">
          <div className="marker-editor-tile">
            <img src={step.url} alt={t.markerPreview} width={96} height={96} />
          </div>
          <figcaption className="fine-print" role="status">
            {step.refined === true
              ? t.markerRefined
              : step.refined === false
                ? t.markerLassoOnly
                : t.markerPreview}
          </figcaption>
        </figure>
      )}
      {error && (
        <p className="message error-message" role="alert">
          {error}
        </p>
      )}
      <div className="actions marker-editor-actions">
        {image && (
          <button
            type="button"
            className="button secondary small"
            disabled={step.kind === "cutting" || saving}
            onClick={useWhole}
          >
            <Scan size={14} aria-hidden="true" />
            {t.markerWholeImage}
          </button>
        )}
        {step.kind === "preview" && (
          <>
            <button
              type="button"
              className="button secondary small"
              disabled={saving}
              onClick={() => {
                setPath([]);
                setStep({ kind: "draw" });
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              {t.markerRedraw}
            </button>
            <button
              type="button"
              className="button small"
              disabled={saving}
              aria-busy={saving || undefined}
              onClick={save}
            >
              {saving ? t.markerSaving : t.markerSave}
            </button>
          </>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => dialog.current?.close()}
        >
          {t.cancel}
        </button>
      </div>
    </dialog>
  );
}
