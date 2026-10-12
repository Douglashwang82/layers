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
      viewBox="0 0 400 400"
      focusable="false"
    >
      {[
        { x: 85, y: 265, scale: 1 },
        { x: 245, y: 125, scale: 0.7 },
        { x: 220, y: 325, scale: 0.6 },
      ].map(({ x, y, scale }) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${scale})`}>
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d="M0 0 Q10 -20 27 -14"
              transform={`translate(${25 + i * 30} ${-35 - i * 27})`}
              fill="none"
              stroke="white"
              strokeWidth="1"
              opacity={0.65 - i * 0.15}
            />
          ))}
          <path d="M0 -30 27 -15 0 1 -27 -15Z" fill="#fff" />
          <path d="M-27 -15 0 1 0 32 -27 16Z" fill="#e4e4e4" />
          <path d="M0 1 27 -15 27 16 0 32Z" fill="#ccc" />
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
