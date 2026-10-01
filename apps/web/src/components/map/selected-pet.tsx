"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MapboxMap } from "mapbox-gl";
import { MarkerPet } from "../mascot/marker-pet";
import type { PetTarget } from "@/lib/marker-pet";

export function SelectedPet({
  map,
  target,
  label,
  animate,
  onActivate,
}: {
  map: MapboxMap | null;
  target: PetTarget | null;
  label: string;
  animate: boolean;
  onActivate: () => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const lng = target?.lng;
  const lat = target?.lat;
  useEffect(() => {
    if (!map || lng == null || lat == null) return;
    let cancelled = false;
    let remove = () => {};
    import("mapbox-gl")
      .then(({ default: mapboxgl }) => {
        if (cancelled) return;
        const element = document.createElement("div");
        element.className = "map-pet-host";
        // V2 tip = (120,240) of 240×256. Correct the 1/16-height
        // transparent bottom margin; Mapbox alone owns host transforms.
        const marker = new mapboxgl.Marker({
          element,
          anchor: "bottom",
          offset: [0, 8],
          pitchAlignment: "viewport",
          rotationAlignment: "viewport",
        })
          .setLngLat([lng, lat])
          .addTo(map);
        remove = () => marker.remove();
        // Mapbox's default img role would hide the nested button from AT.
        element.removeAttribute("role");
        element.removeAttribute("aria-label");
        const fitPet = () => {
          const size = element.getBoundingClientRect();
          marker.setOffset([0, size.height / 16]);
          const point = map.project([lng, lat]);
          const viewport = map.getContainer();
          const padding = map.getPadding();
          const top = padding.top ?? 0;
          const bottom = viewport.clientHeight - (padding.bottom ?? 0);
          const horizontalMargin = size.width / 2 + 8;
          if (
            point.x < (padding.left ?? 0) + horizontalMargin ||
            point.x >
              viewport.clientWidth - (padding.right ?? 0) - horizontalMargin ||
            point.y < top + size.height ||
            point.y > bottom - 24
          ) {
            // Keep the entire head in view above the mobile sheet. Only fit
            // on selection/layout changes, never in response to user panning.
            const centerY = (top + bottom) / 2;
            const tipY = Math.min(
              bottom - 24,
              Math.max(centerY, top + size.height),
            );
            map.easeTo({
              center: [lng, lat],
              offset: [0, tipY - centerY],
              duration:
                animate &&
                !window.matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? 240
                  : 0,
            });
          }
        };
        map.on("resize", fitPet);
        remove = () => {
          map.off("resize", fitPet);
          marker.remove();
        };
        fitPet();
        setHost(element);
      })
      .catch(() => {
        remove();
        // Existing map pins and detail panels remain usable if decoration fails.
      });
    return () => {
      cancelled = true;
      remove();
      setHost(null);
    };
  }, [map, lng, lat, animate]);
  return host && target
    ? createPortal(
        <MarkerPet
          key={target.key}
          label={label}
          animate={animate}
          onActivate={onActivate}
        />,
        host,
      )
    : null;
}
