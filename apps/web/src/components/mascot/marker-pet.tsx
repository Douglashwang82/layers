"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./marker-pet.css";

export type PetPose = "front" | "curious" | "happy";

// Windows into the supplied V2 board, not redrawn or generated substitutes.
// Each source tip is translated to (120, 240) in a 240 × 256 viewport.
const frames: Record<PetPose, { x: number; y: number; outline: string }> = {
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
  const frame = frames[pose];
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
  onActivate,
}: {
  label: string;
  pose?: PetPose;
  context?: "map" | "display";
  animate?: boolean;
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
        {(["front", "curious", "happy"] as const).map((frame) => (
          <span
            key={frame}
            className="marker-pet__frame"
            data-visible={currentPose === frame}
          >
            <PetArtwork pose={frame} />
          </span>
        ))}
      </span>
    </button>
  );
}
