"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty">
      <h1>We couldn’t load this page.</h1>
      <p>無法載入此頁面。Please try again.</p>
      <button className="button" onClick={reset}>
        Try again / 再試一次
      </button>
    </div>
  );
}
