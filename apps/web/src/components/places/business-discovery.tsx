"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import type { Copy } from "@/lib/dictionary";
import type {
  LatLng,
  PlacesProvider,
  ProviderPlace,
} from "@/lib/places/provider";
import { track } from "@/lib/track";
import { ProviderAutocomplete, ProviderSearch } from "./provider-slot";
/**
 * "Find a business": provider autocomplete for names, and an explicit
 * submitted category search biased to the current map view. Panning never
 * triggers a request; only submitting does.
 */
export function BusinessDiscovery({
  provider,
  cityCenter,
  currentCenter,
  t,
  onSelect,
  onResults,
}: {
  provider: PlacesProvider;
  cityCenter: LatLng;
  currentCenter: () => LatLng | null;
  t: Copy;
  onSelect: (place: ProviderPlace) => void;
  onResults: (places: ProviderPlace[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState<{
    query: string;
    bias: LatLng;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    track("business_search_opened", {});
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = draft.trim();
    if (!query) return;
    setFailed(false);
    setSubmitted({ query, bias: currentCenter() ?? cityCenter });
  };
  const select = (place: ProviderPlace) => {
    track("business_selected", { located: !!place.location });
    onSelect(place);
  };
  const error = () => {
    setFailed(true);
    track("places_component_failed", { type: "search" });
  };
  return (
    <div className="business-discovery">
      <p className="fine-print">{t.businessSearchHint}</p>
      <ProviderAutocomplete
        provider={provider}
        bias={cityCenter}
        label={t.businessSearchLabel}
        onSelect={select}
        onError={error}
      />
      <form className="map-search" role="search" onSubmit={submit}>
        <label className="sr-only" htmlFor="business-category">
          {t.businessCategoryLabel}
        </label>
        <Search size={18} aria-hidden="true" />
        <input
          id="business-category"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t.businessCategoryLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // Never submit while an IME is still composing Chinese input.
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.nativeEvent.isComposing)
              e.preventDefault();
          }}
        />
        <button type="submit" className="button small">
          {t.businessCategorySubmit}
        </button>
      </form>
      {failed && (
        <p className="message error-message" role="alert">
          {t.businessUnavailable}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setFailed(false);
              setSubmitted((s) => (s ? { ...s } : s));
            }}
          >
            {t.retry}
          </button>
        </p>
      )}
      {submitted && !failed && (
        <section aria-label={t.businessResults}>
          <ProviderSearch
            provider={provider}
            query={submitted.query}
            bias={submitted.bias}
            onResults={(places) => {
              track("places_component_loaded", { type: "search" });
              onResults(places);
            }}
            onSelect={select}
            onError={error}
          />
        </section>
      )}
    </div>
  );
}
