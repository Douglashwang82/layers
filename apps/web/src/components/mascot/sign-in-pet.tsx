"use client";

import { useEffect, useState } from "react";
import { PetArtwork, PetRender, type PetPose } from "./marker-pet";
import { petShape, type PetShape } from "./pet-shape";
import "./sign-in-pet.css";

/**
 * The idle loop the pet plays while nobody is using the form: each step is a
 * pose and how long it holds. It repeats forever (the pause button and
 * reduced motion stop it).
 */
const LOOP: readonly { pose: PetPose; ms: number }[] = [
  { pose: "hero", ms: 4200 },
  { pose: "happy", ms: 1900 },
  { pose: "hero", ms: 3400 },
  { pose: "curious", ms: 2800 },
  { pose: "front", ms: 2600 },
];
const GREET_MS = 1_400;
/** Each expression's mark pops, holds briefly, fades, then unmounts. */
const MARK_MS = 1_400;

type Mark = "notice" | "sparkle" | "question" | "dots";
const markFor: Record<PetPose, Mark> = {
  hero: "notice",
  happy: "sparkle",
  curious: "question",
  front: "dots",
};

/**
 * Glossier than the matte map marker: a full clear coat and a warm inner glow
 * so it reads as jelly, with a soft, hazy highlight rather than a crisp one.
 * Its idle flow is small and calm.
 */
const stageShape: PetShape = {
  ...petShape,
  jelly: {
    ...petShape.jelly,
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.38,
    sheen: 0.3,
    rimStrength: 0.12,
    coreStrength: 0.12,
  },
  flow: { breathe: 0.008, sway: 0.014, ripple: 0.007 },
};

function MarkArt({ kind }: { kind: Mark }) {
  switch (kind) {
    case "notice":
      // V2's three "noticing" strokes.
      return (
        <>
          <path d="M8 8 L16 36" />
          <path d="M30 40 L52 26" />
          <path d="M30 70 L56 72" />
        </>
      );
    case "sparkle":
      return (
        <>
          <path
            className="fill"
            d="M24 6 C26 18 30 22 42 24 C30 26 26 30 24 42 C22 30 18 26 6 24 C18 22 22 18 24 6 Z"
          />
          <path
            className="fill"
            d="M48 44 C49 50 51 52 57 53 C51 54 49 56 48 62 C47 56 45 54 39 53 C45 52 47 50 48 44 Z"
          />
          <circle className="fill" cx="14" cy="60" r="3.5" />
        </>
      );
    case "question":
      return (
        <>
          <path d="M18 22 C18 10 42 8 42 22 C42 32 30 32 30 44" />
          <circle className="fill" cx="30" cy="62" r="4.5" />
        </>
      );
    case "dots":
      return (
        <>
          <circle className="fill" cx="12" cy="56" r="4.5" />
          <circle className="fill" cx="30" cy="50" r="4.5" />
          <circle className="fill" cx="48" cy="44" r="4.5" />
        </>
      );
  }
}

/**
 * V2's hero view on the sign-in stage. It watches the form panel from the
 * outside (focus, success and error messages) so auth never depends on it,
 * and it only loads WebGL on desktop, where the stage is shown.
 */
export function SignInPet({ pauseLabel }: { pauseLabel: string }) {
  const [desktop, setDesktop] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(0);
  const [focused, setFocused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [mark, setMark] = useState<{ kind: Mark; id: number } | null>(null);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 801px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      setDesktop(wide.matches);
      setReduced(still.matches);
    };
    change();
    wide.addEventListener("change", change);
    still.addEventListener("change", change);
    return () => {
      wide.removeEventListener("change", change);
      still.removeEventListener("change", change);
    };
  }, []);
  // Form reactions take priority over the loop.
  useEffect(() => {
    if (!desktop) return;
    const panel = document.querySelector<HTMLElement>(".form-panel");
    let succeeded = false;
    let greet: ReturnType<typeof setTimeout> | undefined;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const focus = () => setFocused(!!panel?.contains(document.activeElement));
    // Focus has moved by the next task, so read it there.
    const blur = () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(focus);
    };
    const messages = () => {
      setFailed(!!panel?.querySelector(".error-message"));
      const success = !!panel?.querySelector(".success-message");
      if (success && !succeeded) {
        setCelebrating(true);
        clearTimeout(greet);
        greet = setTimeout(() => setCelebrating(false), GREET_MS);
      }
      succeeded = success;
    };
    const observer = new MutationObserver(messages);
    if (panel) {
      observer.observe(panel, { childList: true, subtree: true });
      panel.addEventListener("focusin", focus);
      panel.addEventListener("focusout", blur);
    }
    focus();
    return () => {
      observer.disconnect();
      panel?.removeEventListener("focusin", focus);
      panel?.removeEventListener("focusout", blur);
      clearTimeout(greet);
      clearTimeout(blurTimer);
    };
  }, [desktop]);
  const looping =
    desktop && !paused && !reduced && !focused && !failed && !celebrating;
  useEffect(() => {
    if (!looping) return;
    const timer = setTimeout(
      () => setStep((s) => (s + 1) % LOOP.length),
      LOOP[step].ms,
    );
    return () => clearTimeout(timer);
  }, [looping, step]);
  const pose: PetPose = celebrating
    ? "happy"
    : failed
      ? "front"
      : focused
        ? "curious"
        : LOOP[step].pose;
  // A brief mark for every new expression (none under reduced motion).
  useEffect(() => {
    if (!desktop || reduced) return;
    setMark((m) => ({ kind: markFor[pose], id: (m?.id ?? 0) + 1 }));
    const timer = setTimeout(() => setMark(null), MARK_MS);
    return () => clearTimeout(timer);
  }, [pose, desktop, reduced]);
  return (
    <>
      <div className="sign-in-pet" data-pose={pose} aria-hidden="true">
        <span className="sign-in-pet__shadow" />
        <span className="sign-in-pet__body">
          {desktop ? (
            <PetRender
              pose={pose}
              animate
              idle={!paused}
              shape={stageShape}
              lighting="stage"
            />
          ) : (
            <span className="marker-pet__frame" data-visible="true">
              <PetArtwork pose="hero" />
            </span>
          )}
        </span>
        {mark && (
          <svg
            key={mark.id}
            className="sign-in-pet__mark"
            data-mark={mark.kind}
            viewBox="0 0 64 80"
            focusable="false"
          >
            <MarkArt kind={mark.kind} />
          </svg>
        )}
      </div>
      {desktop && !reduced && (
        <button
          type="button"
          className="sign-in-pet__pause"
          aria-pressed={paused}
          aria-label={pauseLabel}
          onClick={() => setPaused((p) => !p)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {paused ? (
              <path d="M8 5.5v13l10.5-6.5z" />
            ) : (
              <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
            )}
          </svg>
        </button>
      )}
    </>
  );
}
