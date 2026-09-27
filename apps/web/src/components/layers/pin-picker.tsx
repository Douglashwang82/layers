"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Crosshair, MapPinned } from "lucide-react";
import type { Copy } from "@/lib/dictionary";
type Pin = { latitude: number; longitude: number };
/**
 * Optional pin placement for a custom place. Click or drag to place; keyboard
 * users pan with the arrow keys and choose "Use map center". Without a map
 * token nothing renders and the address/current-location paths remain.
 */
export function PinPicker({
  token,
  center,
  value,
  onChange,
  t,
}: {
  token?: string;
  center: Pin;
  value: Pin | null;
  onChange: (pin: Pin) => void;
  t: Copy;
}) {
  const [open, setOpen] = useState(false);
  /** The map module has loaded and the map exists; until then center-pinning is unavailable. */
  const [ready, setReady] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  /** Places or moves the marker; set once the map module has loaded. */
  const placeRef = useRef<((pin: Pin) => void) | null>(null);
  const latest = useRef({ onChange, value });
  useEffect(() => {
    latest.current = { onChange, value };
  });
  const { latitude: centerLat, longitude: centerLng } = center;
  // Keep the marker in step with pins chosen elsewhere (e.g. current location).
  useEffect(() => {
    if (value) placeRef.current?.(value);
  }, [value]);
  useEffect(() => {
    if (!open || !token || !container.current) return;
    let disposed = false;
    let dispose = () => {};
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (disposed || !container.current) return;
      const start = latest.current.value ?? {
        latitude: centerLat,
        longitude: centerLng,
      };
      const map = new mapboxgl.Map({
        container: container.current,
        accessToken: token,
        style: "mapbox://styles/mapbox/light-v11",
        center: [start.longitude, start.latitude],
        zoom: latest.current.value ? 15 : 11,
        attributionControl: true,
      });
      mapRef.current = map;
      map.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        "bottom-right",
      );
      const place = (pin: Pin) => {
        if (!markerRef.current) {
          markerRef.current = new mapboxgl.Marker({ draggable: true })
            .setLngLat([pin.longitude, pin.latitude])
            .addTo(map);
          markerRef.current.on("dragend", () => {
            const at = markerRef.current!.getLngLat();
            latest.current.onChange({ latitude: at.lat, longitude: at.lng });
          });
        } else markerRef.current.setLngLat([pin.longitude, pin.latitude]);
      };
      placeRef.current = place;
      setReady(true);
      if (latest.current.value) place(latest.current.value);
      map.on("click", (event) => {
        const pin = { latitude: event.lngLat.lat, longitude: event.lngLat.lng };
        place(pin);
        latest.current.onChange(pin);
      });
      dispose = () => {
        setReady(false);
        placeRef.current = null;
        markerRef.current = null;
        mapRef.current = null;
        map.remove();
      };
    });
    return () => {
      disposed = true;
      dispose();
    };
  }, [open, token, centerLat, centerLng]);
  if (!token) return null;
  function pinCenter() {
    const map = mapRef.current;
    if (!map) return;
    const at = map.getCenter();
    const pin = { latitude: at.lat, longitude: at.lng };
    placeRef.current?.(pin);
    onChange(pin);
  }
  return (
    <div className="pin-picker">
      <button
        type="button"
        className="button secondary small"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MapPinned size={14} aria-hidden="true" />
        {open ? t.hideMap : t.dropPin}
      </button>
      {open && (
        <>
          <p className="fine-print">{t.pinHelp}</p>
          <div
            ref={container}
            className="pin-picker-map"
            role="application"
            aria-label={t.dropPin}
          />
          <button
            type="button"
            className="button secondary small"
            disabled={!ready}
            aria-busy={!ready || undefined}
            onClick={pinCenter}
          >
            <Crosshair size={14} aria-hidden="true" />
            {t.useMapCenter}
          </button>
        </>
      )}
    </div>
  );
}
