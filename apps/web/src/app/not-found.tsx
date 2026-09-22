import Link from "next/link";
import { getCopy } from "@/lib/i18n";
export default async function NotFound() {
  const t = await getCopy();
  return (
    <div className="container">
      <div className="empty">
        <h1>{t.notFound}</h1>
        <p>{t.emptyBody}</p>
        <Link className="button" href="/">
          {t.returnHome}
        </Link>
      </div>
    </div>
  );
}
