"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { LayerLink as Link } from "../layers/workspace-navigation";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { track } from "@/lib/track";

/** One suggestion as the API returns it. Refs and fact IDs stay on the server. */
export type LayerSuggestion = {
  type: "layer_tip";
  title: string;
  body: string;
  layerSlug: string;
};
type Response =
  | { status: "none" }
  | { status: "ready"; generatedAt: string; suggestions: LayerSuggestion[] };
type Failure = "failed" | "rate_limited" | "unavailable";

type State =
  | { key: string; phase: "settled"; response: Response }
  | { key: string; phase: "generating" }
  | { key: string; phase: "error"; failure: Failure };

const endpoint = "/api/v1/map/suggestions";

function parse(json: unknown): Response | null {
  const data = (json as { data?: Response } | null)?.data;
  if (data?.status === "none") return data;
  if (data?.status === "ready" && Array.isArray(data.suggestions)) return data;
  return null;
}

/**
 * Cached layer suggestions for one map query. The GET never calls the model; it
 * runs only while `enabled`. Generating is the POST behind the button. A result
 * of an earlier query is never returned for the current one.
 */
export function useLayerSuggestions(queryKey: string, enabled: boolean) {
  const [state, setState] = useState<State | null>(null);
  const posting = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`${endpoint}${queryKey}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        const response = parse(json) ?? { status: "none" as const };
        if (controller.signal.aborted) return;
        // A generate request started meanwhile owns the state.
        setState((s) =>
          s?.key === queryKey && s.phase === "generating"
            ? s
            : { key: queryKey, phase: "settled", response },
        );
      })
      .catch(() => {
        // A failed read hides results silently and leaves the button.
        if (!controller.signal.aborted)
          setState((s) =>
            s?.key === queryKey && s.phase === "generating"
              ? s
              : {
                  key: queryKey,
                  phase: "settled",
                  response: { status: "none" },
                },
          );
      });
    return () => {
      controller.abort();
      posting.current?.abort();
    };
  }, [queryKey, enabled]);
  const generate = useCallback(() => {
    posting.current?.abort();
    const controller = new AbortController();
    posting.current = controller;
    setState({ key: queryKey, phase: "generating" });
    const fail = (failure: Failure) => {
      if (controller.signal.aborted) return;
      setState({ key: queryKey, phase: "error", failure });
      track("layer_suggestions_failed", {
        outcome: failure,
        type: "layer_tip",
      });
    };
    fetch(`${endpoint}${queryKey}`, {
      method: "POST",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (controller.signal.aborted) return;
        if (r.status === 429) return fail("rate_limited");
        if (r.status === 503 || r.status === 404) return fail("unavailable");
        const response = r.ok ? parse(await r.json()) : null;
        if (!response) return fail("failed");
        if (controller.signal.aborted) return;
        setState({ key: queryKey, phase: "settled", response });
        track("layer_suggestions_generated", {
          outcome:
            response.status === "ready" && response.suggestions.length
              ? "ready"
              : "empty",
          type: "layer_tip",
        });
      })
      .catch(() => fail("failed"));
  }, [queryKey]);
  return {
    // Nothing from an old key, and nothing at all while disabled.
    state: enabled && state?.key === queryKey ? state : null,
    generate,
  };
}

/** One renderer per suggestion type; a new type adds an entry here. */
const renderers: Record<
  LayerSuggestion["type"],
  (suggestion: LayerSuggestion, t: Copy) => ReactNode
> = {
  layer_tip: (suggestion, t) => (
    <>
      <h4>{suggestion.title}</h4>
      <p>{suggestion.body}</p>
      <Link
        className="button secondary small"
        href={`/layers/${encodeURIComponent(suggestion.layerSlug)}`}
        onClick={() =>
          track("layer_suggestion_acted", {
            outcome: "view_layer",
            type: suggestion.type,
          })
        }
      >
        {t.viewLayer}
      </Link>
    </>
  ),
};

export function LayerSuggestions({
  queryKey,
  enabled,
  t,
  locale,
}: {
  queryKey: string;
  enabled: boolean;
  t: Copy;
  locale: Locale;
}) {
  const { state, generate } = useLayerSuggestions(queryKey, enabled);
  const [open, setOpen] = useState(true);
  if (!enabled) return null;
  const suggestions =
    state?.phase === "settled" && state.response.status === "ready"
      ? state.response.suggestions.filter((s) => s.type in renderers)
      : null;
  const generating = state?.phase === "generating";
  const emptyResult =
    state?.phase === "settled" &&
    state.response.status === "ready" &&
    !suggestions?.length;
  const showButton =
    state != null &&
    !generating &&
    (state.phase === "error" ||
      (state.phase === "settled" && state.response.status === "none"));
  const error =
    state?.phase === "error"
      ? state.failure === "rate_limited"
        ? t.suggestionsRateLimited
        : state.failure === "unavailable"
          ? t.suggestionsUnavailable
          : t.suggestionsFailed
      : null;
  const status = generating
    ? t.suggestionsGenerating
    : suggestions?.length
      ? format(t.suggestionsReady, { count: suggestions.length })
      : emptyResult
        ? t.suggestionsNone
        : (error ?? "");
  return (
    <section
      className="layer-suggestions"
      aria-labelledby="layer-suggestions-title"
    >
      <h3 id="layer-suggestions-title" className="layer-suggestions-heading">
        <button
          type="button"
          className="layer-suggestions-toggle"
          aria-expanded={open}
          aria-controls="layer-suggestions-body"
          onClick={() => setOpen((o) => !o)}
        >
          <Sparkles size={16} aria-hidden="true" />
          <span>{t.suggestionsTitle}</span>
          {open ? (
            <ChevronUp size={18} aria-hidden="true" />
          ) : (
            <ChevronDown size={18} aria-hidden="true" />
          )}
        </button>
      </h3>
      <div id="layer-suggestions-body" hidden={!open}>
        <p className="layer-suggestions-disclosure muted">
          {t.suggestionsDisclosure}
        </p>
        {showButton && (
          <button
            type="button"
            className="button secondary small layer-suggestions-action"
            onClick={generate}
          >
            {state.phase === "error"
              ? t.suggestionsRetry
              : t.suggestionsGenerate}
          </button>
        )}
        <p
          className={`layer-suggestions-status${error ? " error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
        {!!suggestions?.length && (
          <ul
            className="layer-suggestions-list"
            aria-label={t.suggestionsList}
            lang={locale}
          >
            {suggestions.map((s, i) => (
              <li key={`${i}:${s.layerSlug}:${s.title}`}>
                {renderers[s.type](s, t)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
