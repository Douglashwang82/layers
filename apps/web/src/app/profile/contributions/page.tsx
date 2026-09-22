import Link from "next/link";
import { redirect } from "next/navigation";
import { pool } from "@taiwanhub/database";
import { currentActor } from "@/lib/session";
import { getCopy, getLocale, dateLabel, type Copy } from "@/lib/i18n";
import { EmptyState } from "@/components/cards";
import { flags } from "@/lib/config";
const statusKey: Record<string, keyof Copy> = {
  pending: "statusPending",
  approved: "statusApproved",
  rejected: "statusRejected",
  hidden: "statusHidden",
};
const typeKey: Record<string, keyof Copy> = {
  places: "places",
  events: "events",
  notes: "notesLabel",
  sightings: "sightingsLabel",
  recommendations: "recommendationsLabel",
  content: "contentLabel",
  layers: "layerWord",
};
export default async function Contributions() {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/profile/contributions");
  const [t, locale, result] = await Promise.all([
    getCopy(),
    getLocale(),
    pool.query<{
      id: string;
      entity_type: string;
      status: string;
      created_at: Date;
    }>(
      "SELECT id,entity_type,status,created_at FROM submission WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [actor.id],
    ),
  ]);
  return (
    <div className="container page-bottom">
      <nav className="breadcrumbs" aria-label={t.profile}>
        <Link href="/profile">← {t.profile}</Link>
      </nav>
      <div className="page-header">
        <h1>{t.contributions}</h1>
        <p>{t.notesPending}</p>
      </div>
      {result.rows.length === 0 ? (
        <EmptyState
          t={t}
          body={t.joinBody}
          action={
            flags.submissions
              ? { href: "/submit/place", label: t.submitPlace }
              : undefined
          }
        />
      ) : (
        <ul className="contribution-list">
          {result.rows.map((s) => (
            <li className="contribution-row" key={s.id}>
              <div>
                <h3>{t[typeKey[s.entity_type] ?? "submissions"]}</h3>
                <p className="muted">{dateLabel(s.created_at, locale)}</p>
              </div>
              <span className={`status status-${s.status}`}>
                {t[statusKey[s.status] ?? "status"]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
