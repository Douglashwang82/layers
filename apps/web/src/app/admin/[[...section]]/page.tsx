import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { pool } from "@taiwanhub/database";
import { currentActor } from "@/lib/session";
import { getCopy } from "@/lib/i18n";
import { isModerator, kinds, type Kind } from "@taiwanhub/shared";
import { getContent, tables } from "@/features/catalog/repository";
import { ModerateControls, EditContentForm } from "@/components/admin-controls";
export default async function Admin({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?next=/admin");
  if (!isModerator(actor.role)) notFound();
  const t = await getCopy();
  const { section } = await params;
  const kind = section?.[0];
  const admin = actor.role === "ADMIN";
  const pending = (
    await pool.query<{
      id: string;
      entity_type: string;
      entity_id: string;
      reason: string | null;
      created_at: Date;
      preview: string;
      detail: string;
    }>(
      `SELECT s.*,COALESCE(p.name,e.name,n.body,pr.name,'Community content') AS preview,COALESCE(p.description,e.description,n.body,concat_ws(' · ',store.name,ps.observed_at::text,ps.price::text)) AS detail FROM submission s LEFT JOIN place p ON s.entity_type='places' AND p.id=s.entity_id LEFT JOIN event e ON s.entity_type='events' AND e.id=s.entity_id LEFT JOIN place_note n ON s.entity_type='notes' AND n.id=s.entity_id LEFT JOIN product_sighting ps ON s.entity_type='sightings' AND ps.id=s.entity_id LEFT JOIN product pr ON pr.id=ps.product_id LEFT JOIN place store ON store.id=ps.place_id WHERE s.status='pending' ORDER BY s.created_at LIMIT 100`,
    )
  ).rows;
  const items =
    kind && kinds.includes(kind as Kind)
      ? await Promise.all(
          (
            await pool.query<{ id: string }>(
              `SELECT id FROM ${tables[kind as Kind]} ORDER BY updated_at DESC LIMIT 100`,
            )
          ).rows.map((r) => getContent(kind as Kind, r.id, true)),
        )
      : [];
  return (
    <div className="container page-bottom">
      <div className="page-header">
        <h1>{t.admin}</h1>
        <p>{t.editHelp}</p>
      </div>
      <nav className="tabs">
        <Link href="/admin">
          {t.pendingQueue} ({pending.length})
        </Link>
        {kinds.map((k) => (
          <Link key={k} href={"/admin/" + k}>
            {t[k]}
          </Link>
        ))}
      </nav>
      {items.length
        ? items.map((item) => (
            <article className="admin-item" key={item.id}>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <span className="status">{item.status}</span>
              <EditContentForm {...{ item, t }} kind={kind!} />
              <ModerateControls
                entityType={kind!}
                entityId={item.id}
                {...{ t, admin }}
              />
            </article>
          ))
        : pending.map((s) => (
            <article className="admin-item" key={s.id}>
              <span className="eyebrow">{s.entity_type}</span>
              <h3>{s.preview}</h3>
              <p>{s.detail}</p>
              <p>{s.reason ?? t.pending}</p>
              <small>{s.entity_id}</small>
              <ModerateControls
                entityType={s.entity_type}
                entityId={s.entity_id}
                {...{ t, admin }}
              />
            </article>
          ))}
    </div>
  );
}
