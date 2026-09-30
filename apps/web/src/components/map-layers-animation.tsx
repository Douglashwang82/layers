"use client";

import { useEffect, useRef } from "react";
import { CITY_BUILDINGS, CITY_COLORS } from "./sign-in-city/layout";
import type { CityScene } from "./sign-in-city/scene";

/** An SSR illustration stays visible until the optional WebGL scene is ready. */
export function MapLayersAnimation() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current!;
    const desktop = matchMedia("(min-width: 801px)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let loading = false;
    let visible = false;
    let failed = false;
    let scene: CityScene | undefined;
    function release() {
      scene?.dispose();
      scene = undefined;
      delete element.dataset.ready;
    }
    async function sync() {
      if (disposed) return;
      if (!desktop.matches) {
        release();
        return;
      }
      const active = visible && !document.hidden;
      if (!scene && !loading && !failed && active) {
        loading = true;
        try {
          const { createCityScene } = await import("./sign-in-city/scene");
          if (disposed || !desktop.matches || !visible || document.hidden)
            return;
          scene = createCityScene(element, () => {
            failed = true;
            release();
          });
          element.dataset.ready = "true";
        } catch {
          // WebGL, shader compilation or chunk loading must never block auth.
          failed = true;
          release();
        } finally {
          loading = false;
        }
      }
      scene?.setMotion(!reduced.matches);
      scene?.setActive(active);
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      void sync();
    });
    observer.observe(element);
    desktop.addEventListener("change", sync);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      observer.disconnect();
      desktop.removeEventListener("change", sync);
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      release();
    };
  }, []);
  return (
    <div ref={host} className="sign-in-city" aria-hidden="true">
      <svg
        className="sign-in-city-fallback"
        viewBox="0 0 760 640"
        focusable="false"
      >
        <g transform="translate(380 350)">
          <path d="M-340 0 0-172 340 0 0 172Z" fill="#193e34" />
          <path d="M-340 0 0 172 340 0V12L0 184-340 12Z" fill="#376353" />
          {CITY_BUILDINGS.toSorted((a, b) => a.x + a.z - b.x - b.z).map(
            (b, i) => {
              const x = (b.x - b.z) * 12,
                y = (b.x + b.z) * 6;
              const w = b.w * 12,
                d = b.d * 6,
                h = b.h * 17;
              return (
                <g key={i} transform={`translate(${x} ${y})`}>
                  <path
                    d={`M${-w} 0 0 ${d}V${d - h}L${-w} ${-h}Z`}
                    fill={CITY_COLORS[b.layer]}
                  />
                  <path
                    d={`M0 ${d} ${w} 0V${-h}L0 ${d - h}Z`}
                    fill={CITY_COLORS[b.layer]}
                  />
                  <path
                    d={`M0 ${d} ${w} 0V${-h}L0 ${d - h}Z`}
                    fill="#14261f"
                    opacity=".16"
                  />
                  <path
                    d={`M${-w} ${-h} 0 ${-d - h} ${w} ${-h} 0 ${d - h}Z`}
                    fill="#f6faf5"
                  />
                </g>
              );
            },
          )}
        </g>
      </svg>
    </div>
  );
}
