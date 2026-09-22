"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { api, StatusMessage } from "@/components/actions";
import type { EditableLayer } from "@/features/map/detail";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { layerTitle } from "@/lib/layer-labels";
/**
 * The picker lists only layers the actor can edit. One destination per
 * submission; an already-added item shows "Added" instead of duplicating.
 * Adding creates a reference and never Saves — the two are distinct choices.
 */
export function AddToLayer({
  itemKey,
  itemCity,
  layers,
  authenticated,
  t,
  locale,
  onChanged,
  compact = false,
}: {
  itemKey: string;
  itemCity: string;
  layers: EditableLayer[];
  authenticated: boolean;
  t: Copy;
  locale: Locale;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const returnTo = () =>
    typeof window === "undefined"
      ? pathname
      : window.location.pathname + window.location.search;
  if (!authenticated)
    return (
      <button
        type="button"
        className={`button secondary ${compact ? "small" : ""}`}
        onClick={() =>
          router.push("/sign-in?next=" + encodeURIComponent(returnTo()))
        }
      >
        <Plus size={16} aria-hidden="true" />
        {t.addToLayer}
      </button>
    );
  async function add(layer: EditableLayer) {
    setPending(layer.id);
    setFeedback(null);
    try {
      await api(`layers/${layer.id}/items`, "POST", { key: itemKey });
      setAdded((a) => ({ ...a, [layer.id]: true }));
      setFeedback({
        tone: "success",
        text: `${t.addedToLayer}: ${layerTitle(layer, locale)}`,
      });
      onChanged?.();
    } catch (e) {
      setFeedback({ tone: "error", text: (e as Error).message });
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="add-to-layer">
      <button
        type="button"
        className={`button secondary ${compact ? "small" : ""}`}
        aria-expanded={open}
        aria-controls={`add-to-layer-${itemKey}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={16} aria-hidden="true" />
        {t.addToLayer}
      </button>
      {open && (
        <div
          className="picker"
          id={`add-to-layer-${itemKey}`}
          role="group"
          aria-label={t.chooseLayerPicker}
        >
          <p className="fine-print">{t.saveVsAdd}</p>
          {layers.length === 0 ? (
            <p className="muted">{t.noLayersMine}</p>
          ) : (
            <ul className="picker-list">
              {layers.map((layer) => {
                const contains = layer.contains || added[layer.id];
                const otherCity = layer.citySlug !== itemCity;
                return (
                  <li key={layer.id}>
                    <button
                      type="button"
                      className="picker-row"
                      disabled={contains || otherCity || pending !== null}
                      aria-busy={pending === layer.id || undefined}
                      onClick={() => add(layer)}
                    >
                      <span className="picker-text">
                        <span>{layerTitle(layer, locale)}</span>
                        <small>
                          {layer.audience === "private"
                            ? t.audiencePrivate
                            : layer.audience === "group"
                              ? t.audienceGroup
                              : t.audiencePublic}
                          {otherCity && ` · ${t.otherCityLayer}`}
                        </small>
                      </span>
                      {contains ? (
                        <span className="picker-state">
                          <Check size={14} aria-hidden="true" />
                          {t.alreadyInLayer}
                        </span>
                      ) : pending === layer.id ? (
                        <span className="picker-state">{t.saving}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <Link
            className="text-button"
            href={`/layers/new?add=${encodeURIComponent(itemKey)}&next=${encodeURIComponent(returnTo())}`}
          >
            {t.newLayer}
          </Link>
          <StatusMessage feedback={feedback} />
        </div>
      )}
      {!open && feedback && <StatusMessage feedback={feedback} />}
      {compact && open && layers.length > 0 && (
        <span className="sr-only">
          {format(t.itemsCount, { count: layers.length })}
        </span>
      )}
    </div>
  );
}
