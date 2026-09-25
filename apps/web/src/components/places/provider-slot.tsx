"use client";
import { useEffect, useRef } from "react";
import type {
  Cleanup,
  PlacesProvider,
  ProviderPlace,
} from "@/lib/places/provider";
/**
 * Mounts one provider component into a stable container and removes it on
 * unmount (including development double-mounts). Callbacks are read through a
 * ref so re-renders never remount the component or repeat a paid request.
 */
function useProviderMount(
  mount: ((container: HTMLElement) => Promise<Cleanup>) | null,
  deps: unknown[],
  onError: () => void,
) {
  const container = useRef<HTMLDivElement>(null);
  const errorRef = useRef(onError);
  useEffect(() => {
    errorRef.current = onError;
  });
  useEffect(() => {
    const node = container.current;
    if (!node || !mount) return;
    let cleanup: Cleanup | null = null;
    let cancelled = false;
    mount(node)
      .then((c) => {
        if (cancelled) c();
        else cleanup = c;
      })
      .catch(() => {
        if (!cancelled) errorRef.current();
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return container;
}
export function ProviderDetails({
  provider,
  placeId,
  compact,
  onLoad,
  onError,
}: {
  provider: PlacesProvider;
  placeId: string;
  compact: boolean;
  onLoad: (place: ProviderPlace) => void;
  onError: () => void;
}) {
  const handlers = useRef({ onLoad, onError });
  useEffect(() => {
    handlers.current = { onLoad, onError };
  });
  const container = useProviderMount(
    (node) =>
      provider.mountDetails(
        node,
        { placeId, compact },
        {
          onLoad: (p) => handlers.current.onLoad(p),
          onError: () => handlers.current.onError(),
        },
      ),
    [provider, placeId, compact],
    () => handlers.current.onError(),
  );
  return <div ref={container} className="provider-slot" />;
}
export function ProviderAutocomplete({
  provider,
  bias,
  label,
  onSelect,
  onError,
}: {
  provider: PlacesProvider;
  bias: { lat: number; lng: number };
  label: string;
  onSelect: (place: ProviderPlace) => void;
  onError: () => void;
}) {
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  });
  const container = useProviderMount(
    (node) =>
      provider.mountAutocomplete(node, { bias, label }, (p) =>
        select.current(p),
      ),
    // Bias changes do not remount: the city center is fixed for this component's life.
    [provider, label],
    onError,
  );
  return <div ref={container} className="provider-slot" />;
}
export function ProviderSearch({
  provider,
  query,
  bias,
  onResults,
  onSelect,
  onError,
}: {
  provider: PlacesProvider;
  query: string;
  bias: { lat: number; lng: number };
  onResults: (places: ProviderPlace[]) => void;
  onSelect: (place: ProviderPlace) => void;
  onError: () => void;
}) {
  const handlers = useRef({ onResults, onSelect, onError });
  useEffect(() => {
    handlers.current = { onResults, onSelect, onError };
  });
  // A new request happens only when the submitted query or its area changes.
  const container = useProviderMount(
    (node) =>
      provider.mountSearch(
        node,
        { query, bias, maxResults: 10 },
        {
          onResults: (p) => handlers.current.onResults(p),
          onSelect: (p) => handlers.current.onSelect(p),
          onError: () => handlers.current.onError(),
        },
      ),
    [provider, query, bias.lat, bias.lng],
    () => handlers.current.onError(),
  );
  return <div ref={container} className="provider-slot" />;
}
