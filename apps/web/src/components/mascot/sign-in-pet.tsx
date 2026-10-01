"use client";

import { useEffect, useState } from "react";
import { PetArtwork, PetRender, type PetPose } from "./marker-pet";
import { petShape, type PetShape } from "./pet-shape";
import "./sign-in-pet.css";

/** Idle liquid motion stops on its own after this, so nothing loops forever. */
const IDLE_MS = 10_000;
const ENTRANCE_GREET_MS = 900;
const GREET_MS = 1_200;

/**
 * The stage pet is glossier than the matte map marker: a full clear coat with
 * a crisp highlight and a warm inner glow, so it reads as sleek jelly. Its
 * idle flow is small and calm.
 */
const stageShape: PetShape = {
  ...petShape,
  jelly: {
    ...petShape.jelly,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    sheen: 0.25,
    rimStrength: 0.12,
    coreStrength: 0.12,
  },
  flow: { breathe: 0.008, sway: 0.014, ripple: 0.007 },
};

/**
 * V2's hero view on the sign-in stage. It watches the form panel from the
 * outside (focus, success and error messages) so auth never depends on it,
 * and it only loads WebGL on desktop, where the stage is shown.
 */
export function SignInPet() {
  const [desktop, setDesktop] = useState(false);
  const [pose, setPose] = useState<PetPose>("hero");
  const [idle, setIdle] = useState(true);
  const [greeting, setGreeting] = useState(0);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 801px)");
    const change = () => setDesktop(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    const panel = document.querySelector<HTMLElement>(".form-panel");
    let focused = false,
      celebrating = false,
      failed = false,
      succeeded = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number, run: () => void) => {
      const id = setTimeout(() => {
        timers.delete(id);
        run();
      }, ms);
      timers.add(id);
    };
    const settle = () =>
      setPose(
        celebrating ? "happy" : failed ? "front" : focused ? "curious" : "hero",
      );
    const greet = () => {
      celebrating = true;
      setGreeting((n) => n + 1);
      settle();
      later(GREET_MS, () => {
        celebrating = false;
        settle();
      });
    };
    const focus = () => {
      focused = !!panel?.contains(document.activeElement);
      settle();
    };
    const messages = () => {
      failed = !!panel?.querySelector(".error-message");
      const success = !!panel?.querySelector(".success-message");
      if (success && !succeeded) greet();
      succeeded = success;
      settle();
    };
    // Focus has moved by the next task, so read it there.
    const blur = () => later(0, focus);
    const observer = new MutationObserver(messages);
    if (panel) {
      observer.observe(panel, { childList: true, subtree: true });
      panel.addEventListener("focusin", focus);
      panel.addEventListener("focusout", blur);
    }
    focus();
    later(ENTRANCE_GREET_MS, greet);
    later(IDLE_MS, () => setIdle(false));
    return () => {
      observer.disconnect();
      panel?.removeEventListener("focusin", focus);
      panel?.removeEventListener("focusout", blur);
      timers.forEach(clearTimeout);
    };
  }, [desktop]);
  return (
    <div className="sign-in-pet" data-pose={pose} aria-hidden="true">
      <span className="sign-in-pet__shadow" />
      <span className="sign-in-pet__body">
        {desktop ? (
          <PetRender
            pose={pose}
            animate
            idle={idle}
            shape={stageShape}
            lighting="stage"
          />
        ) : (
          <span className="marker-pet__frame" data-visible="true">
            <PetArtwork pose="hero" />
          </span>
        )}
      </span>
      {/* V2's three "noticing" strokes beside the head; they pop on greetings. */}
      <svg
        key={greeting}
        className="sign-in-pet__marks"
        viewBox="0 0 64 80"
        focusable="false"
      >
        <path d="M8 8 L16 36" />
        <path d="M30 40 L52 26" />
        <path d="M30 70 L56 72" />
      </svg>
    </div>
  );
}
