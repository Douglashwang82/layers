import { useCallback, useSyncExternalStore } from "react";
import type { AtlasTheme } from "./map-appearance";

export type MapThemePreference = "system" | AtlasTheme;
export const mapThemeStorageKey = "taiwanhub.map.theme";
const darkQuery = "(prefers-color-scheme: dark)";

export function parseMapThemePreference(
  value: string | null | undefined,
): MapThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveMapTheme(
  preference: MapThemePreference,
  systemDark: boolean,
): AtlasTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

// Survives blocked storage for the life of the page.
let memory: MapThemePreference | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  const query = window.matchMedia(darkQuery);
  query.addEventListener("change", listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    query.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
  };
}

function readPreference(): MapThemePreference {
  if (memory) return memory;
  try {
    return parseMapThemePreference(localStorage.getItem(mapThemeStorageKey));
  } catch {
    return "system";
  }
}

/**
 * A per-device preference (never server state). Server and first client render
 * use the light theme, then the stored or OS preference applies.
 */
export function useMapTheme() {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    () => "system" as const,
  );
  const systemDark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(darkQuery).matches,
    () => false,
  );
  const setPreference = useCallback((next: MapThemePreference) => {
    memory = next;
    try {
      localStorage.setItem(mapThemeStorageKey, next);
    } catch {
      // Storage can be blocked; the choice then lasts only until reload.
    }
    notify();
  }, []);
  return {
    preference,
    theme: resolveMapTheme(preference, systemDark),
    setPreference,
  };
}
