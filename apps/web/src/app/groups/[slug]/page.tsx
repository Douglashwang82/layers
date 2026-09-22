import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Plus, Users } from "lucide-react";
import { pool } from "@taiwanhub/database";
import { getCopy, getLocale, format } from "@/lib/i18n";
import { currentActor } from "@/lib/session";
import { flags } from "@/lib/config";
import {
  getGroup,
  listInvites,
  listMembers,
} from "@/features/groups/repository";
import { getLayer, type LayerWithAccess } from "@/features/layers/repository";
import { LayerCard } from "@/components/layers/layer-card";
import { GroupMembers } from "@/components/groups/group-management";
import { roleLabel } from "@/lib/layer-labels";
export const metadata: Metadata = { title: "Group", robots: { index: false } };
async function groupLayers(groupId: string) {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT l.id FROM layer l WHERE l.owner_group_id=$1 AND l.lifecycle<>'archived' ORDER BY l.updated_at DESC LIMIT 50`,
    [groupId],
  );
  return result.rows.map((r) => String(r.id));
}
export default async function GroupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [{ slug }, t, locale, actor] = await Promise.all([
    params,
    getCopy(),
    getLocale(),
    currentActor(),
  ]);
  const found = await getGroup(slug, actor);
  if (!found) notFound();
  const { group, role } = found;
  const name =
    locale === "zh-TW" && group.nameChinese ? group.nameChinese : group.name;
  const member = !!role && !!actor;
  const [members, invites, layerIds] = member
    ? await Promise.all([
        listMembers(group.id),
        role === "owner" ? listInvites(group.id) : Promise.resolve([]),
        groupLayers(group.id),
      ])
    : [[], [], []];
  const layers = (
    await Promise.all(layerIds.map((id) => getLayer(id, actor)))
  ).filter((entry): entry is LayerWithAccess => !!entry);
  return (
    <div className="container page-bottom">
      <nav className="breadcrumbs" aria-label={t.back}>
        <Link href="/layers?tab=groups">← {t.groups}</Link>
      </nav>
      <header className="layer-detail-header">
        <p className="eyebrow">
          <Users size={14} aria-hidden="true" />
          {t.groups} · {group.cityName}
        </p>
        <h1>{name}</h1>
        {group.description && <p>{group.description}</p>}
        <p className="muted">
          {format(t.memberCount, { count: group.memberCount })}
          {role && ` · ${roleLabel(role, t)}`}
        </p>
        {!member && (
          <div className="notice">
            <Lock size={14} aria-hidden="true" /> {t.groupIdentityNote}
            {!actor && (
              <>
                {" "}
                <Link
                  href={`/sign-in?next=${encodeURIComponent(`/groups/${group.slug}`)}`}
                >
                  {t.signIn}
                </Link>
              </>
            )}
          </div>
        )}
      </header>
      {member && (
        <>
          <section className="section" aria-labelledby="group-layers-heading">
            <div className="section-heading">
              <div>
                <h2 id="group-layers-heading">{t.groupLayers}</h2>
                <p>{t.audienceGroup}</p>
              </div>
              {flags.layerWrites && role !== "viewer" && (
                <Link
                  className="button secondary small"
                  href={`/layers/new?group=${group.id}`}
                >
                  <Plus size={14} aria-hidden="true" />
                  {t.createLayer}
                </Link>
              )}
            </div>
            {layers.length === 0 ? (
              <p className="muted">{t.noGroupLayers}</p>
            ) : (
              <div className="layer-cards">
                {layers.map((entry) => (
                  <LayerCard
                    key={entry.layer.id}
                    entry={entry}
                    t={t}
                    locale={locale}
                    own={false}
                  />
                ))}
              </div>
            )}
          </section>
          {flags.layerWrites && (
            <GroupMembers
              group={group}
              members={members}
              invites={invites}
              role={role!}
              userId={actor!.id}
              t={t}
              locale={locale}
            />
          )}
        </>
      )}
    </div>
  );
}
