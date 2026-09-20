import { redirect } from "next/navigation";
import { pool } from "@taiwanhub/database";
import { currentActor } from "@/lib/session";
import { getCopy, getLocale, dateLabel } from "@/lib/i18n";
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
      <div className="page-header">
        <h1>{t.contributions}</h1>
      </div>
      {result.rows.map((s) => (
        <article className="admin-item" key={s.id}>
          <h3>{s.entity_type}</h3>
          <p>
            {dateLabel(s.created_at, locale)} ·{" "}
            <span className="status">{s.status}</span>
          </p>
        </article>
      ))}
    </div>
  );
}
