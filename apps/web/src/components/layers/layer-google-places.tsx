"use client";
import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { LayerEvent } from "@taiwanhub/shared";
import { api, StatusMessage } from "@/components/actions";
import { ProviderDetails } from "@/components/places/provider-slot";
import type { ExternalReference } from "@/features/map/external";
import { getPlacesProvider } from "@/lib/places/provider";
import type { Copy, Locale } from "@/lib/dictionary";
import { LayerItemEvents } from "./layer-item-events";
type Feedback = { tone: "success" | "error"; text: string } | null;
type Page = { references: ExternalReference[]; nextCursor: string | null };
/**
 * The Google places in one layer: for its editors a provider preview per
 * place, its events and removal; read-only, just the previews. The server
 * knows only place IDs, so the names and addresses shown come from the
 * Places UI Kit.
 */
export function LayerGooglePlaces({
  layer,
  city,
  providerKey,
  events = [],
  onEvents,
  reload = 0,
  readOnly = false,
  onCount,
  t,
  locale,
}: {
  layer: { id: string; slug: string };
  city: { slug: string; name: string; timezone: string };
  providerKey: string | null;
  events?: LayerEvent[];
  onEvents?: (key: string, events: LayerEvent[]) => void;
  /** Changes whenever places were added elsewhere on the page. */
  reload?: number;
  /** Viewers see the places without removal or event editing. */
  readOnly?: boolean;
  /** Reports how many Google places are listed, for the page's item count. */
  onCount?: (count: number) => void;
  t: Copy;
  locale: Locale;
}) {
  const provider = useMemo(
    () => getPlacesProvider(providerKey ?? undefined, locale),
    [providerKey, locale],
  );
  const [refs, setRefs] = useState<ExternalReference[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: ExternalReference[] = [];
      let cursor: string | null = null;
      // Bounded: a layer holds at most a few pages of external places.
      for (let page = 0; page < 20; page++) {
        const response = await fetch(
          `/api/v1/map/external-references?city=${encodeURIComponent(city.slug)}&layers=${encodeURIComponent(layer.slug)}${cursor ? `&cursor=${cursor}` : ""}`,
        );
        const json = (await response.json()) as {
          data?: Page;
          error?: { message: string };
        };
        if (!json.data) throw new Error(json.error?.message ?? t.error);
        all.push(...json.data.references);
        cursor = json.data.nextCursor;
        if (!cursor) break;
      }
      if (!cancelled) setRefs(all);
    })().catch((err: Error) => {
      if (!cancelled) setFeedback({ tone: "error", text: err.message });
    });
    return () => {
      cancelled = true;
    };
  }, [layer.slug, city.slug, reload, t.error]);
  useEffect(() => {
    onCount?.(refs.length);
  }, [onCount, refs.length]);
  async function remove(ref: ExternalReference) {
    setPending(ref.subjectId);
    setFeedback(null);
    try {
      await api(
        `layers/${layer.id}/items?key=${encodeURIComponent(ref.canonicalKey)}`,
        "DELETE",
      );
      setRefs((list) => list.filter((r) => r.subjectId !== ref.subjectId));
      setFeedback({ tone: "success", text: t.removed });
    } catch (err) {
      setFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setPending(null);
    }
  }
  if (!refs.length && !feedback) return null;
  return (
    <section aria-labelledby="google-places-heading">
      <h3 id="google-places-heading">
        {t.googlePlacesInLayer}{" "}
        <span className="count-pill">{refs.length}</span>
      </h3>
      <ul className="layer-contents google-places">
        {refs.map((ref, index) => {
          // Provider names stay inside the provider component; rows are numbered instead.
          const name = `#${index + 1}`;
          return (
            <li key={ref.subjectId} className="result-row">
              <div className="google-place-row">
                {provider && ref.providerPlaceId ? (
                  <ProviderDetails
                    provider={provider}
                    placeId={ref.providerPlaceId}
                    compact
                    onLoad={() => {}}
                    onError={() => {}}
                  />
                ) : (
                  <p className="fine-print">{t.externalUnavailable}</p>
                )}
                {ref.localNote && <p className="muted">{ref.localNote}</p>}
                {!readOnly && (
                  <span className="editor-item-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`${t.removeGooglePlace} ${name}`}
                      disabled={pending === ref.subjectId}
                      aria-busy={pending === ref.subjectId || undefined}
                      onClick={() => remove(ref)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
              {!readOnly && (
                <LayerItemEvents
                  layerId={layer.id}
                  itemKey={ref.canonicalKey}
                  itemName={name}
                  events={events.filter((e) => e.key === ref.canonicalKey)}
                  city={city}
                  t={t}
                  locale={locale}
                  onChange={(next) => onEvents?.(ref.canonicalKey, next)}
                />
              )}
            </li>
          );
        })}
      </ul>
      <StatusMessage feedback={feedback} />
    </section>
  );
}
