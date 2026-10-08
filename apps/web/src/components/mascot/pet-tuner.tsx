"use client";

import { useId, useState } from "react";
import type { Copy } from "@/lib/dictionary";
import { petShape, type PetShape } from "./pet-shape";

type Label = keyof Copy & `mascotTune${string}`;
type Slider = {
  path: readonly string[];
  label: Label;
  min: number;
  max: number;
  step: number;
};

// Ranges bracket the V2 defaults; they explore the form, not brand limits.
const groups: { title: Label; sliders: Slider[] }[] = [
  {
    title: "mascotTuneBody",
    sliders: [
      {
        path: ["depth"],
        label: "mascotTuneDepth",
        min: 0.8,
        max: 1.6,
        step: 0.01,
      },
      {
        path: ["squareness"],
        label: "mascotTuneSquareness",
        min: 2,
        max: 4,
        step: 0.05,
      },
      { path: ["lean"], label: "mascotTuneLean", min: 0, max: 0.8, step: 0.01 },
    ],
  },
  {
    title: "mascotTuneFace",
    sliders: [
      {
        path: ["face", "y"],
        label: "mascotTuneFaceY",
        min: 1,
        max: 1.6,
        step: 0.005,
      },
      {
        path: ["face", "halfWidth"],
        label: "mascotTuneFaceWidth",
        min: 0.4,
        max: 0.75,
        step: 0.005,
      },
      {
        path: ["face", "halfHeight"],
        label: "mascotTuneFaceHeight",
        min: 0.35,
        max: 0.65,
        step: 0.005,
      },
      {
        path: ["face", "inset"],
        label: "mascotTuneFaceInset",
        min: 0,
        max: 0.06,
        step: 0.001,
      },
    ],
  },
  {
    title: "mascotTuneEyes",
    sliders: [
      {
        path: ["eyes", "x"],
        label: "mascotTuneEyeSpacing",
        min: 0.18,
        max: 0.42,
        step: 0.002,
      },
      {
        path: ["eyes", "y"],
        label: "mascotTuneEyeY",
        min: 1.1,
        max: 1.5,
        step: 0.002,
      },
      {
        path: ["eyes", "halfWidth"],
        label: "mascotTuneEyeWidth",
        min: 0.08,
        max: 0.2,
        step: 0.002,
      },
      {
        path: ["eyes", "halfHeight"],
        label: "mascotTuneEyeHeight",
        min: 0.12,
        max: 0.3,
        step: 0.002,
      },
    ],
  },
  {
    title: "mascotTuneSurface",
    sliders: [
      {
        path: ["jelly", "roughness"],
        label: "mascotTuneRoughness",
        min: 0.05,
        max: 0.8,
        step: 0.01,
      },
      {
        path: ["jelly", "rimStrength"],
        label: "mascotTuneGlow",
        min: 0,
        max: 0.6,
        step: 0.01,
      },
    ],
  },
  {
    title: "mascotTuneMotion",
    sliders: [
      {
        path: ["flow", "breathe"],
        label: "mascotTuneBreathe",
        min: 0,
        max: 0.05,
        step: 0.001,
      },
      {
        path: ["flow", "sway"],
        label: "mascotTuneSway",
        min: 0,
        max: 0.08,
        step: 0.001,
      },
      {
        path: ["squish", "compress"],
        label: "mascotTuneSquish",
        min: 0,
        max: 0.6,
        step: 0.01,
      },
    ],
  },
];
const colors: { path: readonly string[]; label: Label }[] = [
  { path: ["skin"], label: "mascotTuneSkin" },
  { path: ["face", "color"], label: "mascotTuneFaceColor" },
];

export const DEFAULT_PET_SIZE = 280;

function read(shape: PetShape, path: readonly string[]) {
  return path.reduce<unknown>(
    (node, key) => (node as Record<string, unknown>)[key],
    shape,
  );
}

function write(shape: PetShape, path: readonly string[], value: unknown) {
  const next = structuredClone(shape);
  const parent = path
    .slice(0, -1)
    .reduce<Record<string, unknown>>(
      (node, key) => node[key] as Record<string, unknown>,
      next,
    );
  parent[path[path.length - 1]] = value;
  return next;
}

/** Everything except the traced outline, which the panel does not change. */
function values(shape: PetShape) {
  return JSON.stringify(
    shape,
    (key, value) => (key === "outline" ? undefined : value),
    2,
  );
}

export function PetTuner({
  t,
  shape,
  size,
  onShape,
  onSize,
}: {
  t: Copy;
  shape: PetShape;
  size: number;
  onShape: (shape: PetShape) => void;
  onSize: (size: number) => void;
}) {
  const id = useId();
  const [status, setStatus] = useState("");
  const band =
    size < 192
      ? t.mascotTuneSizeSmall
      : size <= 320
        ? t.mascotTuneSizeHero
        : t.mascotTuneSizeLarge;
  return (
    <section className="pet-tuner" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t.mascotTuneTitle}</h2>
      <p className="pet-tuner__intro">{t.mascotTuneIntro}</p>
      <fieldset>
        <legend>{t.mascotTuneSize}</legend>
        <label className="pet-tuner__row" htmlFor={`${id}-size`}>
          <span>{t.mascotTuneSize}</span>
          <input
            id={`${id}-size`}
            type="range"
            min={96}
            max={480}
            step={4}
            value={size}
            aria-describedby={`${id}-band`}
            onChange={(e) => onSize(Number(e.target.value))}
          />
          <output htmlFor={`${id}-size`}>{size} px</output>
        </label>
        <p className="pet-tuner__note" id={`${id}-band`}>
          {band}
        </p>
      </fieldset>
      {groups.map((group) => (
        <fieldset key={group.title}>
          <legend>{t[group.title]}</legend>
          {group.sliders.map((slider) => {
            const inputId = `${id}-${slider.path.join("-")}`;
            const value = read(shape, slider.path) as number;
            return (
              <label className="pet-tuner__row" htmlFor={inputId} key={inputId}>
                <span>{t[slider.label]}</span>
                <input
                  id={inputId}
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={value}
                  onChange={(e) =>
                    onShape(write(shape, slider.path, Number(e.target.value)))
                  }
                />
                <output htmlFor={inputId}>{Number(value.toFixed(3))}</output>
              </label>
            );
          })}
          {group.title === "mascotTuneSurface" &&
            colors.map((color) => {
              const inputId = `${id}-${color.path.join("-")}`;
              const value = read(shape, color.path) as string;
              return (
                <label
                  className="pet-tuner__row"
                  htmlFor={inputId}
                  key={inputId}
                >
                  <span>{t[color.label]}</span>
                  <input
                    id={inputId}
                    type="color"
                    value={value}
                    onChange={(e) =>
                      onShape(write(shape, color.path, e.target.value))
                    }
                  />
                  <output htmlFor={inputId}>{value}</output>
                </label>
              );
            })}
        </fieldset>
      ))}
      <div className="pet-tuner__actions">
        <button
          type="button"
          onClick={() => {
            onShape(structuredClone(petShape));
            onSize(DEFAULT_PET_SIZE);
            setStatus("");
          }}
        >
          {t.mascotTuneReset}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!navigator.clipboard) {
              setStatus(t.mascotTuneCopyFailed);
              return;
            }
            navigator.clipboard.writeText(values(shape)).then(
              () => setStatus(t.mascotTuneCopied),
              () => setStatus(t.mascotTuneCopyFailed),
            );
          }}
        >
          {t.mascotTuneCopy}
        </button>
      </div>
      <p className="pet-tuner__note" role="status">
        {status}
      </p>
      <details className="pet-tuner__values">
        <summary>{t.mascotTuneValues}</summary>
        <pre>{values(shape)}</pre>
      </details>
    </section>
  );
}
