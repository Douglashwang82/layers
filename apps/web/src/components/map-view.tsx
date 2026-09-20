"use client";
import { useEffect, useRef, useState } from "react";
import type { Content } from "@/features/catalog/repository";
import type { Copy } from "@/lib/i18n";
import "mapbox-gl/dist/mapbox-gl.css";
export function MapView({ items, t }: { items: Content[]; t: Copy }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  useEffect(() => {
    if (!token || !ref.current) return;
    let dispose = () => {};
    let stopped = false;
    import("mapbox-gl")
      .then(({ default: mapboxgl }) => {
        if (stopped || !ref.current) return;
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
          const popup = document.createElement("div");
          const image = document.createElement("img");
          image.src = item.image;
          image.alt = item.name;
          const title = document.createElement("strong");
          title.textContent = item.name;
          const detail = document.createElement("p");
          detail.textContent = `${item.category} · ${item.score === null ? t.noVotes : item.score + "% " + t.score}`;
          const link = document.createElement("a");
          link.href = "/places/" + item.slug;
          link.textContent = t.details;
          popup.append(image, title, detail, link);
          new mapboxgl.Marker({ color: "#365c49" })
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
  }, [items, t, token]);
  if (!token || failed)
    return (
      <div className="map-container map-fallback">
        <p>{t.mapMissing}</p>
        {items[0] && (
          <a
            className="button secondary"
            target="_blank"
            rel="noreferrer"
            href={`https://www.google.com/maps/search/?api=1&query=${items[0].latitude},${items[0].longitude}`}
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
