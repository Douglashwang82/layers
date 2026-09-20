import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty">
      <h1>This page is unavailable.</h1>
      <p>此頁面不存在。</p>
      <Link className="button" href="/">
        Back to home / 返回首頁
      </Link>
    </div>
  );
}
