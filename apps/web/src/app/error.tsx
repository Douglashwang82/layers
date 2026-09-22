"use client";
import { useEffect, useState } from "react";
import { en, zh, type Copy } from "@/lib/dictionary";
export default function ErrorPage({ reset }: { reset: () => void }) {
  // Client boundary: pick the dictionary from the document language after mount.
  const [t, setT] = useState<Copy>(en);
  useEffect(() => {
    if (document.documentElement.lang === "zh-TW") setT(zh);
  }, []);
  return (
    <div className="container">
      <div className="empty" role="alert">
        <h1>{t.error}</h1>
        <p>{t.errorBody}</p>
        <button type="button" className="button" onClick={reset}>
          {t.retry}
        </button>
      </div>
    </div>
  );
}
