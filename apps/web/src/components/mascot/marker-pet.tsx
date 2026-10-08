"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PetShape } from "./pet-shape";
import type { PetLighting } from "./pet-scene";
import "./marker-pet.css";

/** `hero` is V2's large upright three-quarter view (the sign-in stage). */
export type PetPose = "front" | "curious" | "happy" | "hero";

/**
 * The live pet. `animate` enables transitions at all; `idle` additionally
 * runs the continuous liquid motion (pose changes still animate without it).
 */
export function PetRender({
  pose,
  animate,
  idle = true,
  shape,
  lighting = "map",
}: {
  pose: PetPose;
  animate: boolean;
  idle?: boolean;
  shape?: PetShape;
  lighting?: PetLighting;
}) {
  // The scene is built with the first shape; later changes rebuild it.
  const initial = useRef({ shape, lighting });
  const host = useRef<HTMLSpanElement>(null);
  const scene = useRef<ReturnType<
    typeof import("./pet-scene").createPetScene
  > | null>(null);
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    let cancelled = false;
    import("./pet-scene")
      .then(({ createPetScene }) => {
        if (cancelled || !host.current) return;
        try {
          scene.current = createPetScene(
            host.current,
            () => {
              scene.current?.dispose();
              scene.current = null;
              setReady(false);
            },
            initial.current,
          );
          setReady(true);
        } catch {
          setReady(false);
        }
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.update(pose, animate && !reduced, idle);
  }, [pose, animate, idle, reduced, ready]);
  useEffect(() => {
    if (shape && shape !== initial.current.shape)
      scene.current?.setShape(shape);
  }, [shape, ready]);
  return (
    <>
      {!ready && (
        <span className="marker-pet__frame" data-visible="true">
          <PetArtwork pose={pose} />
        </span>
      )}
      <span
        ref={host}
        className="marker-pet__render"
        data-renderer={ready ? "three" : "fallback"}
        aria-hidden="true"
      />
    </>
  );
}

// Windows into the supplied V2 board, not redrawn or generated substitutes.
// Each source tip is translated to (120, 240) in a 240 × 256 viewport.
const views: Record<
  Exclude<PetPose, "hero">,
  { x: number; y: number; outline: string }
> = {
  front: {
    x: 594,
    y: 109,
    outline:
      "M716 127 C674 123 644 151 636 190 C625 231 636 271 663 300 C684 322 698 349 714 349 C726 349 730 337 741 322 C766 297 792 272 797 239 C804 195 784 153 753 136 C741 129 727 126 716 127 Z",
  },
  curious: {
    x: 786,
    y: 109,
    outline:
      "M891 128 C852 128 831 160 832 207 C830 253 850 285 877 317 C888 332 894 349 906 349 C920 349 931 335 945 320 C964 301 995 282 1012 257 C1029 232 1008 190 986 164 C962 137 925 124 891 128 Z",
  },
  happy: {
    x: 1023,
    y: 109,
    outline:
      "M1120 132 C1083 128 1059 150 1054 189 C1047 232 1060 276 1093 309 C1113 329 1127 348 1143 349 C1155 349 1163 333 1174 318 C1192 294 1218 278 1228 250 C1240 219 1226 185 1203 163 C1181 142 1148 131 1120 132 Z",
  },
};

export function PetArtwork({ pose }: { pose: PetPose }) {
  const id = useId();
  // The board's small 3/4 window stands in for the hero until WebGL is ready.
  const frame = views[pose === "hero" ? "curious" : pose];
  return (
    <svg viewBox="0 0 240 256" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={id}>
          <path d={frame.outline} />
        </clipPath>
      </defs>
      <g transform={`translate(${-frame.x} ${-frame.y})`}>
        <image
          href="/mascot/reference-v2.jpg"
          width="1280"
          height="960"
          clipPath={`url(#${id})`}
        />
      </g>
    </svg>
  );
}

export function MarkerPet({
  label,
  pose = "front",
  context = "map",
  animate = true,
  shape,
  onActivate,
}: {
  label: string;
  pose?: PetPose;
  context?: "map" | "display";
  animate?: boolean;
  /** Overrides the default form; used by the /mascot tuning panel. */
  shape?: PetShape;
  onActivate?: () => void;
}) {
  const [exploring, setExploring] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const currentPose = celebrating ? "happy" : exploring ? "curious" : pose;
  return (
    <button
      type="button"
      className="marker-pet"
      data-context={context}
      data-motion={animate ? "on" : "off"}
      data-celebrating={celebrating}
      data-pose={currentPose}
      aria-label={label}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setExploring(true);
      }}
      onPointerLeave={() => setExploring(false)}
      onFocus={() => setExploring(true)}
      onBlur={() => setExploring(false)}
      onClick={() => {
        if (timer.current) clearTimeout(timer.current);
        setCelebrating(true);
        timer.current = setTimeout(() => setCelebrating(false), 650);
        onActivate?.();
      }}
    >
      <span className="marker-pet__anchor" aria-hidden="true" />
      <span className="marker-pet__body">
        <PetRender pose={currentPose} animate={animate} shape={shape} />
      </span>
    </button>
  );
}
