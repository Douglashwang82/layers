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
  | { status: "none"; reason?: "no_layers" }
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
 * Cached layer suggestions for one map query and language. The GET never calls
 * the model; it runs only while `enabled`. Generating is the POST behind the
 * button; it is aborted only when the key changes or the component unmounts,
 * not when the panel merely closes. A result of an earlier key is never
 * returned for the current one.
 */
export function useLayerSuggestions(
  queryKey: string,
  enabled: boolean,
  locale: Locale,
) {
  const key = `${locale}|${queryKey}`;
  const [state, setState] = useState<State | null>(null);
  const posting = useRef<{ key: string; controller: AbortController } | null>(
    null,
  );
  const reading = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    reading.current = controller;
    const settle = (response: Response) => {
      if (controller.signal.aborted) return;
      // A generate request for this key that is still live owns the state.
      if (posting.current?.key === key) return;
      setState({ key, phase: "settled", response });
    };
    fetch(`${endpoint}${queryKey}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => settle(parse(json) ?? { status: "none" }))
      // A failed read hides results silently and leaves the button.
      .catch(() => settle({ status: "none" }));
    return () => controller.abort();
  }, [key, queryKey, enabled]);
  // A POST belongs to its key: leaving the key or unmounting aborts it and
  // clears its "generating" state so the button never stays stuck.
  useEffect(
    () => () => {
      if (posting.current?.key === key) {
        posting.current.controller.abort();
        posting.current = null;
      }
      setState((s) => (s?.key === key && s.phase === "generating" ? null : s));
    },
    [key],
  );
  const generate = useCallback(() => {
    posting.current?.controller.abort();
    // A read still in flight must not overwrite the result.
    reading.current?.abort();
    const controller = new AbortController();
    posting.current = { key, controller };
    setState({ key, phase: "generating" });
    const done = () => {
      if (posting.current?.controller === controller) posting.current = null;
    };
    const fail = (failure: Failure) => {
      if (controller.signal.aborted) return;
      done();
      setState({ key, phase: "error", failure });
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
        done();
        setState({ key, phase: "settled", response });
        // Nothing was generated when no selected layer can have suggestions.
        if (response.status === "none" && response.reason === "no_layers")
          return;
        track("layer_suggestions_generated", {
          outcome:
            response.status === "ready" && response.suggestions.length
              ? "ready"
              : "empty",
          type: "layer_tip",
        });
      })
      .catch(() => fail("failed"));
  }, [key, queryKey]);
  return {
    // Nothing from an old key, and nothing at all while disabled.
    state: enabled && state?.key === key ? state : null,
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
  const { state, generate } = useLayerSuggestions(queryKey, enabled, locale);
  const [open, setOpen] = useState(true);
  const actionRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wasGenerating = useRef(false);
  const generating = state?.phase === "generating";
  const noLayers =
    state?.phase === "settled" &&
    state.response.status === "none" &&
    state.response.reason === "no_layers";
  // When a request settles, keep keyboard focus in the section: the button
  // that had it is gone or has changed meaning.
  useEffect(() => {
    if (generating) {
      wasGenerating.current = true;
      return;
    }
    if (!wasGenerating.current) return;
    wasGenerating.current = false;
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active !== actionRef.current &&
      !actionRef.current?.contains(active)
    )
      return;
    (listRef.current ?? statusRef.current)?.focus();
  }, [generating]);
  if (!enabled || noLayers) return null;
  const suggestions =
    state?.phase === "settled" && state.response.status === "ready"
      ? state.response.suggestions.filter((s) => s.type in renderers)
      : null;
  const emptyResult =
    state?.phase === "settled" &&
    state.response.status === "ready" &&
    !suggestions?.length;
  const showButton =
    state != null &&
    (generating ||
      state.phase === "error" ||
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
      ? suggestions.length === 1
        ? t.suggestionsReadyOne
        : format(t.suggestionsReady, { count: suggestions.length })
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
            ref={actionRef}
            className="button secondary small layer-suggestions-action"
            disabled={generating}
            aria-busy={generating}
            onClick={generate}
          >
            {state.phase === "error"
              ? t.suggestionsRetry
              : t.suggestionsGenerate}
          </button>
        )}
        <p
          ref={statusRef}
          tabIndex={-1}
          className={`layer-suggestions-status${error ? " error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
        {!!suggestions?.length && (
          <ul
            ref={listRef}
            tabIndex={-1}
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
