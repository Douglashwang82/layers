"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./sign-in-pattern.css";

type CubeScene = ReturnType<
  typeof import("./sign-in-cube-scene").createSignInCube
>;

function CubeFallback() {
  const patternId = useId();
  return (
    <svg
      className="sign-in-pattern__fallback"
      viewBox="0 0 400 440"
      focusable="false"
    >
      <defs>
        <pattern
          id={patternId}
          width="50"
          height="50"
          patternUnits="userSpaceOnUse"
        >
          <path fill="#fff" d="M0 0h50v50H0z" />
          <path
            fill="#090b09"
            d="M25 0h25v25H25zM0 25h25v25H0zM12.5 0 25 12.5 12.5 25 0 12.5zM37.5 25 50 37.5 37.5 50 25 37.5z"
          />
          <path
            fill="#fff"
            d="M37.5 0 50 12.5 37.5 25 25 12.5zM12.5 25 25 37.5 12.5 50 0 37.5z"
          />
        </pattern>
      </defs>
      <ellipse cx="200" cy="385" rx="82" ry="13" fill="#000" opacity="0.07" />
      <g transform="translate(30 33) scale(.85)">
        {[
          "matrix(1.6 .924 -1.6 .924 200 35)",
          "matrix(1.6 .924 0 1.848 40 127.4)",
          "matrix(1.6 -.924 0 1.848 200 219.8)",
        ].map((transform) => (
          <rect
            key={transform}
            width="100"
            height="100"
            transform={transform}
            fill={`url(#${patternId})`}
          />
        ))}
      </g>
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
