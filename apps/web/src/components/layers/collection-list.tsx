"use client";
import { useState } from "react";
import Link from "next/link";
import { maxAppliedLayers } from "@taiwanhub/shared";
import type { mapImportEn } from "@/lib/map-import-copy";
import styles from "./map-import.module.css";
export function CollectionList({
  collections,
  t,
}: {
  collections: {
    id: string;
    title: string;
    layers: { id: string; slug: string; title: string; citySlug: string }[];
  }[];
  t: typeof mapImportEn;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const all = collections.flatMap((c) => c.layers);
  const chosen = all.filter((l) => selected.includes(l.id));
  const city = chosen[0]?.citySlug;
  const query = new URLSearchParams({
    city: city ?? "",
    layers: chosen.map((l) => l.slug).join(","),
    scope: "layers",
    view: "map",
  });
  return (
    <div className="form-stack">
      <p>{t.max.replace("{max}", String(maxAppliedLayers))}</p>
      {collections.length === 0 && <p>{t.empty}</p>}
      {collections.map((c) => (
        <section id={c.id} key={c.id} className="form-panel">
          <h2>{c.title}</h2>
          {c.layers.length > 0 && c.layers.length <= maxAppliedLayers && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={c.layers.every((l) => selected.includes(l.id))}
                disabled={
                  !c.layers.every((l) => selected.includes(l.id)) &&
                  (new Set([...selected, ...c.layers.map((l) => l.id)]).size >
                    maxAppliedLayers ||
                    (!!city && c.layers.some((l) => l.citySlug !== city)))
                }
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...new Set([...old, ...c.layers.map((l) => l.id)])]
                      : old.filter((id) => !c.layers.some((l) => l.id === id)),
                  )
                }
              />
              {t.all}: {c.title}
            </label>
          )}
          <ul>
            {c.layers.map((l) => (
              <li key={l.id}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={selected.includes(l.id)}
                    disabled={
                      !selected.includes(l.id) &&
                      (selected.length >= maxAppliedLayers ||
                        (!!city && city !== l.citySlug))
                    }
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, l.id]
                          : old.filter((id) => id !== l.id),
                      )
                    }
                  />
                  {l.title}
                </label>{" "}
                <Link href={`/layers/${l.slug}`}>{t.open}</Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {chosen.length > 0 && (
        <Link className="button" href={`/?${query}`}>
          {t.show}
        </Link>
      )}
    </div>
  );
}
