"use client";

import { useEffect, useRef, useState } from "react";
import "./sign-in-pattern.css";

type CubeScene = ReturnType<
  typeof import("./sign-in-cube-scene").createSignInCube
>;

function CubeFallback() {
  return (
    <svg
      className="sign-in-pattern__fallback"
      viewBox="0 0 400 500"
      focusable="false"
    >
      {[
        { x: 80, y: 215 },
        { x: 200, y: 290 },
        { x: 310, y: 360 },
      ].map(({ x, y }) => (
        <g
          key={x}
          transform={`translate(${x} ${y})`}
          strokeWidth="1"
          strokeLinejoin="round"
        >
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d="M-23 0 0 -13 23 0 0 13Z"
              transform={`translate(${i * 23} ${-i * 13})`}
              fill="none"
              stroke="white"
              opacity={0.4 - i * 0.09}
            />
          ))}
          <path
            d="M0 -53 23 -40 23 -13 0 0 -23 -13 -23 -40Z"
            fill="#111"
            stroke="white"
          />
          <path d="M-23 -40 0 -27 23 -40M0 -27V0" fill="none" stroke="white" />
        </g>
      ))}
    </svg>
  );
}
export function SignInPattern({ pauseLabel }: { pauseLabel: string }) {
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<CubeScene | null>(null);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 801px)");
    let generation = 0;
    const change = () => {
      const current = ++generation;
      scene.current?.dispose();
      scene.current = null;
      setReady(false);
      if (!desktop.matches) return;
      import("./sign-in-cube-scene")
        .then(({ createSignInCube }) => {
          if (current !== generation || !host.current) return;
          scene.current = createSignInCube(host.current, () => {
            scene.current = null;
            setReady(false);
          });
          setReady(true);
        })
        .catch(() => {
          if (current === generation) setReady(false);
        });
    };
    change();
    desktop.addEventListener("change", change);
    return () => {
      generation++;
      desktop.removeEventListener("change", change);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.setPaused(paused);
  }, [paused, ready]);
  return (
    <>
      <div
        className="sign-in-pattern"
        data-paused={paused}
        data-renderer={ready ? "three" : "fallback"}
        aria-hidden="true"
      >
        {!ready && <CubeFallback />}
        <div ref={host} className="sign-in-pattern__render" />
      </div>
      {ready && (
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
      )}
    </>
  );
}
