"use client";

import { useState, type CSSProperties } from "react";
import "./sign-in-pattern.css";

// A permutation gives each tile its own non-overlapping 800ms turn.
const ORDER = [0, 11, 6, 13, 3, 8, 15, 4, 10, 1, 12, 7, 5, 14, 9, 2];

export function SignInPattern({ pauseLabel }: { pauseLabel: string }) {
  const [paused, setPaused] = useState(false);
  return (
    <>
      <div className="sign-in-pattern" data-paused={paused} aria-hidden="true">
        {ORDER.map((slot, index) => (
          <span
            key={index}
            className="sign-in-pattern__tile"
            data-inverted={(Math.floor(index / 4) + (index % 4)) % 2 === 1}
            style={{ "--delay": `${slot * 800}ms` } as CSSProperties}
          >
            <span className="sign-in-pattern__diamond" />
          </span>
        ))}
      </div>
      <button
        type="button"
        className="sign-in-pattern__pause"
        aria-label={pauseLabel}
        aria-pressed={paused}
        onClick={() => setPaused((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d={
              paused
                ? "M8 5.5v13l10.5-6.5z"
                : "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"
            }
          />
        </svg>
      </button>
    </>
  );
}
