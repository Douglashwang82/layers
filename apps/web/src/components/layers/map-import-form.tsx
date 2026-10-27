"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  maxImportBytes,
  type ImportDocument,
} from "@taiwanhub/shared/map-import";
import { api } from "@/components/actions";
import type { ImportResult } from "@/features/map-import/service";
import type { mapImportEn } from "@/lib/map-import-copy";
import styles from "./map-import.module.css";
type City = { id: string; slug: string; name: string };
type Layer = { id: string; title: string; citySlug: string; revision: number };
export function MapImportForm({
  t,
  cities,
  layers,
  groups,
  initialLayer,
}: {
  t: typeof mapImportEn;
  cities: City[];
  layers: Layer[];
  groups: { id: string; name: string; cityId: string }[];
  initialLayer?: string;
}) {
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<ImportDocument | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"existing" | "new" | "collection">(
    initialLayer ? "existing" : "new",
  );
  const [layerId, setLayerId] = useState(initialLayer ?? layers[0]?.id ?? "");
  const [city, setCity] = useState(cities[0]?.slug ?? "");
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reviewed, setReviewed] = useState<{
    payload: string;
    newPlaces: number;
    reused: number;
  } | null>(null);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    if (!document || result) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [document, result]);
  const reset = () => {
    setReviewed(null);
    setDocument(null);
    setSelected([]);
    setResult(null);
    setError("");
  };
  async function preview() {
    setReviewed(null);
    setBusy(true);
    setError("");
    setDocument(null);
    setResult(null);
    try {
      let body: { file: string } | { url: string };
      if (file) {
        if (file.size > maxImportBytes || !/\.(kml|kmz)$/i.test(file.name))
          throw new Error(t.invalidFile);
        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error(t.invalidFile));
          reader.readAsDataURL(file);
        });
        body = { file: encoded };
      } else body = { url };
      const doc: ImportDocument = await api(
        "map-imports/preview",
        "POST",
        body,
      );
      setDocument(doc);
      setTitle(doc.title);
      setSelected(doc.layers.flatMap((l) => l.points.map((p) => p.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(confirm = false) {
    if (!document || !selected.length) {
      setError(t.noSelection);
      return;
    }
    const layer = layers.find((l) => l.id === layerId);
    const payload = {
      document,
      selected,
      mode,
      title,
      city: mode === "existing" ? layer?.citySlug : city,
      ...(mode === "existing"
        ? { layerId, revision: layer?.revision }
        : { groupId: groupId || undefined }),
      permission,
    };
    const serialized = JSON.stringify(payload);
    if (attempt.current?.payload !== serialized)
      attempt.current = { payload: serialized, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      if (!confirm || reviewed?.payload !== serialized) {
        const review = await api("map-imports/review", "POST", {
          ...payload,
          requestId: attempt.current.id,
        });
        setReviewed({
          payload: serialized,
          newPlaces: review.newPlaces,
          reused: review.reused,
        });
      } else {
        setResult(
          await api("map-imports/commit", "POST", {
            ...payload,
            requestId: attempt.current.id,
          }),
        );
        window.dispatchEvent(new Event("layer:changed"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function toggle(ids: string[], checked: boolean) {
    setReviewed(null);
    setSelected((old) =>
      checked
        ? [...new Set([...old, ...ids])]
        : old.filter((id) => !ids.includes(id)),
    );
  }
  if (result)
    return (
      <section className="form-panel form-stack" aria-live="polite">
        <h2>{t.done}</h2>
        <p>
          {t.added}: {result.added} · {t.reused}: {result.reused} ·{" "}
          {t.resultSkipped}: {result.skipped}
        </p>
        <ul>
          {result.layers.map((l) => (
            <li key={l.id}>
              <Link href={`/layers/${l.slug}`}>
                {l.title} — {t.open}
              </Link>
            </li>
          ))}
        </ul>
        {result.collectionId && (
          <Link href={`/layer-collections#${result.collectionId}`}>
            {t.collections}
          </Link>
        )}
      </section>
    );
  return (
    <div className="form-panel form-stack">
      <p>{t.sourceHelp}</p>
      <fieldset disabled={busy} className="form-stack">
        <legend>{t.source}</legend>
        <label>
          {t.source}
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setFile(null);
              reset();
            }}
            placeholder="https://www.google.com/maps/d/viewer?mid=…"
          />
        </label>
        <label>
          {t.file}
          <input
            type="file"
            accept=".kml,.kmz"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setUrl("");
              reset();
            }}
          />
        </label>
        <button
          className="button secondary"
          type="button"
          disabled={!file && !url}
          onClick={preview}
        >
          {busy ? t.working : t.preview}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="message error-message">
          {error}
        </p>
      )}
      {document && (
        <fieldset
          disabled={busy}
          className="form-stack"
          onChange={() => setReviewed(null)}
        >
          <legend>{t.select}</legend>
          <p>
            {document.layers.length} {t.sourceLayers} · {selected.length}{" "}
            {t.selected} · {t.skipped}: {document.skipped}
          </p>
          <p>{t.duplicates}</p>
          <div>
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                setSelected(
                  document.layers.flatMap((l) => l.points.map((p) => p.id)),
                )
              }
            >
              {t.all}
            </button>{" "}
            <button
              type="button"
              className="button secondary small"
              onClick={() => setSelected([])}
            >
              {t.none}
            </button>
          </div>
          {document.layers.map((l) => (
            <details key={l.id} open={document.layers.length === 1}>
              <summary>
                {l.name} ({l.points.length} {t.markers})
              </summary>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={
                    l.points.length > 0 &&
                    l.points.every((p) => selected.includes(p.id))
                  }
                  onChange={(e) =>
                    toggle(
                      l.points.map((p) => p.id),
                      e.target.checked,
                    )
                  }
                />
                {t.all}: {l.name}
              </label>
              <ul className={styles.markers}>
                {l.points.map((p) => (
                  <li key={p.id}>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={selected.includes(p.id)}
                        onChange={(e) => toggle([p.id], e.target.checked)}
                      />
                      {p.name}
                    </label>
                    <small>
                      {" "}
                      {p.latitude}, {p.longitude}
                    </small>
                    {p.description && (
                      <p className="fine-print">{p.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))}
          <label>
            {t.destination}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="new">{t.newLayer}</option>
              <option value="existing" disabled={!layers.length}>
                {t.existing}
              </option>
              <option value="collection">{t.collection}</option>
            </select>
          </label>
          {mode === "existing" ? (
            <label>
              {t.layer}
              <select
                value={layerId}
                onChange={(e) => setLayerId(e.target.value)}
              >
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                {t.name}
                <input
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                {t.city}
                <select
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value);
                    setGroupId("");
                  }}
                >
                  {cities.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.owner}
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  <option value="">{t.personal}</option>
                  {groups
                    .filter(
                      (g) =>
                        g.cityId === cities.find((c) => c.slug === city)?.id,
                    )
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          <p className="fine-print">{t.cityHelp}</p>
          <p>{t.review}</p>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={permission}
              onChange={(e) => setPermission(e.target.checked)}
            />
            {t.permission}
          </label>
          {reviewed && (
            <p role="status">
              {t.newPlaces}: {reviewed.newPlaces} · {t.reused}:{" "}
              {reviewed.reused}
            </p>
          )}
          <button
            type="button"
            className="button"
            disabled={
              !permission ||
              !selected.length ||
              !title.trim() ||
              (mode === "existing" && !layerId)
            }
            onClick={() => save(!!reviewed)}
          >
            {busy ? t.working : reviewed ? t.save : t.checkDestination}
          </button>
        </fieldset>
      )}
    </div>
  );
}
