"use client";

import { useState } from "react";
import Link from "next/link";
import type { Copy } from "@/lib/dictionary";
import { MarkerPet, type PetPose } from "./marker-pet";
import "./mascot-studio.css";

export function MascotStudio({ t }: { t: Copy }) {
  const [pose, setPose] = useState<PetPose>("front");
  const [animate, setAnimate] = useState(true);
  return (
    <div className="mascot-studio">
      <div className="mascot-studio__intro">
        <p className="mascot-studio__eyebrow">TaiwanHub · Warm Pin V2</p>
        <h1>{t.mascotTitle}</h1>
        <p>{t.mascotIntro}</p>
      </div>
      <div className="mascot-studio__grid">
        <section className="mascot-studio__stage" aria-label={t.mascotTitle}>
          <MarkerPet
            label={t.mascotHint}
            pose={pose}
            animate={animate}
            context="display"
          />
          <div
            className="mascot-studio__poses"
            role="group"
            aria-label={t.mascotTitle}
          >
            {(
              [
                ["front", t.mascotFront],
                ["curious", t.mascotCurious],
                ["happy", t.mascotHappy],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={pose === value}
                onClick={() => setPose(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="mascot-studio__motion">
            <input
              type="checkbox"
              checked={animate}
              onChange={(e) => setAnimate(e.target.checked)}
            />
            {t.mascotMotion}
          </label>
          <p>{t.mascotHint}</p>
        </section>
        <section
          className="mascot-studio__reference"
          aria-label={t.mascotReference}
        >
          <img
            src="/mascot/reference-v2.jpg"
            width="1280"
            height="960"
            alt={t.mascotReference}
          />
          <p>{t.mascotMapHint}</p>
          <Link className="button" href="/">
            {t.mascotBack} →
          </Link>
        </section>
      </div>
    </div>
  );
}
