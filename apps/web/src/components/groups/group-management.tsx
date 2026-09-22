"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, UserMinus, UserPlus } from "lucide-react";
import { api, StatusMessage } from "@/components/actions";
import { Field } from "@/components/ui/field";
import type {
  GroupInvite,
  GroupMember,
  GroupRecord,
} from "@/features/groups/repository";
import type { GroupRole } from "@/features/layers/repository";
import { type Copy, type Locale, format, dateLabel } from "@/lib/dictionary";
import { roleLabel } from "@/lib/layer-labels";
type Feedback = { tone: "success" | "error"; text: string } | null;
/** Owners invite, change roles and remove; anyone can leave; the last owner is protected server-side. */
export function GroupMembers({
  group,
  members,
  invites,
  role,
  userId,
  t,
  locale,
}: {
  group: GroupRecord;
  members: GroupMember[];
  invites: GroupInvite[];
  role: GroupRole;
  userId: string;
  t: Copy;
  locale: Locale;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [inviteFeedback, setInviteFeedback] = useState<Feedback>(null);
  const [inviteLink, setInviteLink] = useState<{
    url: string;
    email: string;
  } | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const owner = role === "owner";
  async function run(label: string, fn: () => Promise<unknown>) {
    setPending(label);
    setFeedback(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setFeedback({ tone: "error", text: (e as Error).message });
    } finally {
      setPending(null);
    }
  }
  async function invite(e: FormEvent) {
    e.preventDefault();
    setPending("invite");
    setInviteFeedback(null);
    try {
      const created = (await api(`groups/${group.id}/invites`, "POST", {
        email,
        role: inviteRole,
      })) as { token: string; email: string };
      setInviteLink({
        url: `${window.location.origin}/groups/join/${created.token}`,
        email: created.email,
      });
      setEmail("");
      router.refresh();
    } catch (err) {
      setInviteFeedback({ tone: "error", text: (err as Error).message });
    } finally {
      setPending(null);
    }
  }
  return (
    <section
      className="form-panel group-members"
      aria-labelledby="members-heading"
    >
      <h2 id="members-heading">
        {t.members} · {format(t.memberCount, { count: members.length })}
      </h2>
      <ul className="member-list">
        {members.map((member) => (
          <li key={member.userId} className="member-row">
            <span className="member-text">
              <b>{member.name}</b>
              <small>
                {roleLabel(member.role, t)} ·{" "}
                {dateLabel(member.joinedAt, locale)}
              </small>
            </span>
            <span className="member-actions">
              {owner && member.userId !== userId && (
                <label className="sr-only" htmlFor={`role-${member.userId}`}>
                  {t.changeRole}
                </label>
              )}
              {owner && member.userId !== userId && (
                <select
                  id={`role-${member.userId}`}
                  value={member.role}
                  disabled={pending !== null}
                  onChange={(e) =>
                    run(`role-${member.userId}`, () =>
                      api(
                        `groups/${group.id}/members?user=${member.userId}`,
                        "PATCH",
                        {
                          role: e.target.value,
                        },
                      ),
                    )
                  }
                >
                  <option value="owner">{t.roleOwner}</option>
                  <option value="editor">{t.roleEditor}</option>
                  <option value="viewer">{t.roleViewer}</option>
                </select>
              )}
              {(owner || member.userId === userId) && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={pending !== null}
                  aria-busy={pending === `remove-${member.userId}` || undefined}
                  onClick={() =>
                    run(`remove-${member.userId}`, async () => {
                      await api(
                        `groups/${group.id}/members?user=${member.userId}`,
                        "DELETE",
                      );
                      if (member.userId === userId)
                        router.push("/layers?tab=groups");
                    })
                  }
                >
                  <UserMinus size={14} aria-hidden="true" />
                  {member.userId === userId ? t.leaveGroup : t.removeMember}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <StatusMessage feedback={feedback} />
      {owner && (
        <>
          <h3 id="invite-heading">{t.invite}</h3>
          <form
            className="form-stack"
            onSubmit={invite}
            aria-labelledby="invite-heading"
          >
            <div className="form-row">
              <Field id="invite-email" label={t.inviteEmail}>
                <input
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field id="invite-role" label={t.inviteRole}>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as "viewer" | "editor")
                  }
                >
                  <option value="viewer">{t.roleViewer}</option>
                  <option value="editor">{t.roleEditor}</option>
                </select>
              </Field>
            </div>
            <div className="actions">
              <button
                type="submit"
                className="button"
                disabled={pending === "invite"}
                aria-busy={pending === "invite" || undefined}
              >
                <UserPlus size={16} aria-hidden="true" />
                {t.invite}
              </button>
            </div>
            <StatusMessage feedback={inviteFeedback} />
          </form>
          {inviteLink && (
            <div className="notice" role="status">
              <p>{format(t.inviteCreated, { email: inviteLink.email })}</p>
              <p className="invite-url">
                <code>{inviteLink.url}</code>
              </p>
              <button
                type="button"
                className="button secondary small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteLink.url);
                    setInviteFeedback({ tone: "success", text: t.copied });
                  } catch {
                    setInviteFeedback({ tone: "error", text: t.shareFailed });
                  }
                }}
              >
                <Link2 size={14} aria-hidden="true" />
                {t.copyLink}
              </button>
            </div>
          )}
          {invites.length > 0 && (
            <>
              <h3>{t.pendingInvites}</h3>
              <ul className="member-list">
                {invites.map((invite) => (
                  <li key={invite.id} className="member-row">
                    <span className="member-text">
                      <b>{invite.email}</b>
                      <small>
                        {roleLabel(invite.role, t)} ·{" "}
                        {format(t.expires, {
                          date: dateLabel(invite.expiresAt, locale),
                        })}
                      </small>
                    </span>
                    <span className="member-actions">
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={pending !== null}
                        onClick={() =>
                          run(`revoke-${invite.id}`, () =>
                            api(
                              `groups/${group.id}/invites?invite=${invite.id}`,
                              "DELETE",
                            ),
                          )
                        }
                      >
                        {t.revoke}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
export function CreateGroupForm({
  city,
  t,
}: {
  city: { slug: string; name: string };
  t: Copy;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  return (
    <form
      className="form-panel form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setSaving(true);
        setFeedback(null);
        try {
          const created = (await api("groups", "POST", {
            name: form.get("name"),
            nameChinese: form.get("nameChinese"),
            description: form.get("description"),
            city: city.slug,
          })) as { group: { slug: string } };
          router.push(`/groups/${created.group.slug}`);
        } catch (err) {
          setFeedback({ tone: "error", text: (err as Error).message });
          setSaving(false);
        }
      }}
    >
      <h1>{t.createGroup}</h1>
      <p>{t.groupIntro}</p>
      <Field id="group-name" label={t.groupName}>
        <input
          id="group-name"
          name="name"
          type="text"
          required
          maxLength={80}
        />
      </Field>
      <Field id="group-name-zh" label={t.chineseName}>
        <input
          id="group-name-zh"
          name="nameChinese"
          type="text"
          maxLength={80}
        />
      </Field>
      <Field id="group-description" label={t.groupDescription}>
        <textarea
          id="group-description"
          name="description"
          rows={3}
          maxLength={500}
        />
      </Field>
      <p className="field-help">
        {t.groupCity}: {city.name}
      </p>
      <div className="actions">
        <button
          type="submit"
          className="button"
          disabled={saving}
          aria-busy={saving || undefined}
        >
          {saving ? t.saving : t.createGroup}
        </button>
      </div>
      <StatusMessage feedback={feedback} />
    </form>
  );
}
export function AcceptInviteButton({ token, t }: { token: string; t: Copy }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  return (
    <>
      <button
        type="button"
        className="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={async () => {
          setPending(true);
          try {
            const result = (await api(`invites/${token}/accept`, "POST")) as {
              groupSlug: string;
            };
            setFeedback({ tone: "success", text: t.inviteAccepted });
            router.push(`/groups/${result.groupSlug}`);
          } catch (err) {
            setFeedback({ tone: "error", text: (err as Error).message });
            setPending(false);
          }
        }}
      >
        <Check size={16} aria-hidden="true" />
        {t.acceptInvite}
      </button>
      <StatusMessage feedback={feedback} />
    </>
  );
}
