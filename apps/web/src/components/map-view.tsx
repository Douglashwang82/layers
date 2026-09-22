"use client";
import { useEffect, useRef, useState } from "react";
import type { Content } from "@/features/catalog/repository";
import { type Copy, type Locale, localized } from "@/lib/dictionary";
import "mapbox-gl/dist/mapbox-gl.css";
/** Resolve a theme token at runtime so pins follow the stylesheet, not a literal. */
function themeColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}
export function MapView({
  items,
  t,
  locale,
}: {
  items: Content[];
  t: Copy;
  locale: Locale;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  useEffect(() => {
    if (!token) {
      if (process.env.NODE_ENV !== "production")
        console.warn(
          "MapView: NEXT_PUBLIC_MAPBOX_TOKEN is not set; rendering the list-only fallback.",
        );
      return;
    }
    if (!ref.current) return;
    let dispose = () => {};
    let stopped = false;
    import("mapbox-gl")
      .then(({ default: mapboxgl }) => {
        if (stopped || !ref.current) return;
        const pin = themeColor("--th-brand-text", "#006a51");
        const map = new mapboxgl.Map({
          container: ref.current,
          accessToken: token,
          style: "mapbox://styles/mapbox/light-v11",
          center: [items[0]?.longitude ?? -95.48, items[0]?.latitude ?? 29.73],
          zoom: 10,
        });
        map.addControl(new mapboxgl.NavigationControl());
        map.on("error", () => setFailed(true));
        for (const item of items) {
          if (item.latitude == null || item.longitude == null) continue;
          const name = localized(item, locale);
          const popup = document.createElement("div");
          const image = document.createElement("img");
          image.src = item.image;
          image.alt = "";
          const title = document.createElement("strong");
          title.textContent = name;
          const detail = document.createElement("p");
          detail.textContent = `${item.category} · ${
            item.score === null
              ? t.noVotes
              : `${item.score}% ${t.score} · ${item.responses} ${t.responses}`
          }`;
          const link = document.createElement("a");
          link.href = "/places/" + item.slug;
          link.textContent = t.details;
          popup.append(image, title, detail, link);
          new mapboxgl.Marker({ color: pin })
            .setLngLat([item.longitude, item.latitude])
            .setPopup(new mapboxgl.Popup().setDOMContent(popup))
            .addTo(map);
        }
        dispose = () => map.remove();
      })
      .catch(() => setFailed(true));
    return () => {
      stopped = true;
      dispose();
    };
  }, [items, t, token, locale]);
  const first = items.find((i) => i.latitude != null && i.longitude != null);
  if (!token || failed)
    return (
      <div className="map-container map-fallback" role="note">
        <p>{t.mapUnavailable}</p>
        {first && (
          <a
            className="button secondary"
            target="_blank"
            rel="noreferrer"
            href={`https://www.google.com/maps/search/?api=1&query=${first.latitude},${first.longitude}`}
          >
            {t.directions} ↗
          </a>
        )}
      </div>
    );
  return (
    <div className="map-container" role="region" aria-label={t.map}>
      <div ref={ref} style={{ height: "100%" }} />
    </div>
  );
}
