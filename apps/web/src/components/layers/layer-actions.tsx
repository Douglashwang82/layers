"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Link2,
  MapPinned,
  Plus,
  Trash2,
  Archive,
  ArchiveRestore,
  Pencil,
  Globe,
  Lock,
} from "lucide-react";
import {
  maxAppliedLayers,
  parseMapQuery,
  serializeMapQuery,
} from "@taiwanhub/shared";
import { api, StatusMessage } from "@/components/actions";
import type { LayerRecord, LayerAccess } from "@/features/layers/repository";
import { type Copy, type Locale, format } from "@/lib/dictionary";
import { mapSessionKey } from "@/lib/map-session";
import { track } from "@/lib/track";
import { layerTitle } from "@/lib/layer-labels";
/**
 * Apply adds the layer to the current map set (remembered for this session);
 * "only" opens it alone and fits its extent — the shared-link behavior.
 */
export function ApplyLayerButton({
  slug,
  t,
  primary = true,
  only = false,
}: {
  slug: string;
  t: Copy;
  primary?: boolean;
  only?: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const apply = () => {
    track("layer_applied", { layer: slug, from: "library" });
    if (only) {
      router.push(`/?layers=${slug}`);
      return;
    }
    let current: string[] = [];
    let extra = "";
    try {
      const stored = sessionStorage.getItem(mapSessionKey) ?? "";
      const parsed = parseMapQuery(
        Object.fromEntries(new URLSearchParams(stored.replace(/^\?/, ""))),
      );
      current =
        parsed.layers === "none" || parsed.layers === undefined
          ? []
          : parsed.layers;
      extra = serializeMapQuery({
        ...parsed,
        layers: "none",
        item: undefined,
        page: undefined,
      })
        .replace(/^\?/, "")
        .replace(/(^|&)layers=none/, "");
    } catch {
      /* no remembered state */
    }
    if (current.includes(slug)) {
      router.push(`/?layers=${current.join(",")}${extra ? "&" + extra : ""}`);
      return;
    }
    if (current.length >= maxAppliedLayers) {
      setNote(format(t.layerLimit, { max: maxAppliedLayers }));
      return;
    }
    const next = [...current, slug];
    router.push(`/?layers=${next.join(",")}${extra ? "&" + extra : ""}`);
  };
  return (
    <>
      <button
        type="button"
        className={`button ${primary ? "" : "secondary"}`}
        onClick={apply}
      >
        <MapPinned size={16} aria-hidden="true" />
        {only ? t.fitLayer : t.applyToMap}
      </button>
      {note && (
        <p className="message error-message" role="alert">
          {note}
        </p>
      )}
    </>
  );
}
export function FollowLayerButton({
  layerId,
  following,
  authenticated,
  t,
}: {
  layerId: string;
  following: boolean;
  authenticated: boolean;
  t: Copy;
}) {
  const router = useRouter();
  const [state, setState] = useState(following);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  return (
    <>
      <button
        type="button"
        className={`button secondary ${state ? "active" : ""}`}
        disabled={pending}
        aria-busy={pending || undefined}
        aria-pressed={state}
        onClick={async () => {
          if (!authenticated) {
            router.push(
              "/sign-in?next=" + encodeURIComponent(window.location.pathname),
            );
            return;
          }
          setPending(true);
          try {
            const result = await api(
              `layers/${layerId}/follow`,
              state ? "DELETE" : "POST",
            );
            setState(result.following);
            router.refresh();
          } catch (e) {
            setFeedback({ tone: "error", text: (e as Error).message });
          } finally {
            setPending(false);
          }
        }}
      >
        {state && <Check size={16} aria-hidden="true" />}
        {pending ? t.updating : state ? t.followingLayer : t.followLayer}
      </button>
      <StatusMessage feedback={feedback} />
    </>
  );
}
/** Copy a link whose audience is explicitly displayed. The link never grants membership. */
export function ShareLayerButton({
  layer,
  t,
}: {
  layer: LayerRecord;
  t: Copy;
}) {
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const isPublic =
    layer.audience === "public" && layer.reviewStatus === "approved";
  const note =
    layer.ownerKind === "system" || isPublic
      ? t.linkPublicNote
      : layer.audience === "group"
        ? t.linkGroupNote
        : t.linkPrivateNote;
  return (
    <div className="share-layer">
      <button
        type="button"
        className="button secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              `${window.location.origin}/layers/${layer.slug}`,
            );
            setFeedback({ tone: "success", text: `${t.copied} · ${note}` });
            track("layer_share_link_copied", { audience: layer.audience });
          } catch {
            setFeedback({ tone: "error", text: t.shareFailed });
          }
        }}
      >
        <Link2 size={16} aria-hidden="true" />
        {t.copyLink}
      </button>
      <StatusMessage feedback={feedback} />
    </div>
  );
}
export function OwnerActions({
  layer,
  access,
  t,
  locale,
}: {
  layer: LayerRecord;
  access: LayerAccess;
  t: Copy;
  locale: Locale;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  async function run(
    label: string,
    fn: () => Promise<unknown>,
    after?: () => void,
  ) {
    setPending(label);
    setFeedback(null);
    try {
      await fn();
      if (after) after();
      else router.refresh();
    } catch (e) {
      setFeedback({ tone: "error", text: (e as Error).message });
    } finally {
      setPending(null);
    }
  }
  if (!access.edit) return null;
  const archived = layer.lifecycle === "archived";
  return (
    <div className="owner-actions">
      <div className="actions">
        <Link className="button secondary" href={`/layers/${layer.slug}/edit`}>
          <Pencil size={16} aria-hidden="true" />
          {t.editLayer}
        </Link>
        {access.manage && layer.ownerKind === "user" && (
          <button
            type="button"
            className="button secondary"
            disabled={pending !== null}
            aria-busy={pending === "publish" || undefined}
            onClick={() =>
              run("publish", () =>
                api(
                  `layers/${layer.id}/publish`,
                  layer.audience === "public" ? "DELETE" : "POST",
                ),
              )
            }
          >
            {layer.audience === "public" ? (
              <Lock size={16} aria-hidden="true" />
            ) : (
              <Globe size={16} aria-hidden="true" />
            )}
            {layer.audience === "public" ? t.unpublishLayer : t.publishLayer}
          </button>
        )}
        {access.manage && (
          <button
            type="button"
            className="button secondary"
            disabled={pending !== null}
            aria-busy={pending === "archive" || undefined}
            onClick={() =>
              run("archive", () =>
                api(`layers/${layer.id}`, "PATCH", {
                  revision: layer.revision,
                  lifecycle: archived ? "active" : "archived",
                }),
              )
            }
          >
            {archived ? (
              <ArchiveRestore size={16} aria-hidden="true" />
            ) : (
              <Archive size={16} aria-hidden="true" />
            )}
            {archived ? t.restoreLayer : t.archiveLayer}
          </button>
        )}
        {access.manage && (
          <button
            type="button"
            className="button secondary"
            disabled={pending !== null}
            onClick={() => setConfirming((c) => !c)}
            aria-expanded={confirming}
          >
            <Trash2 size={16} aria-hidden="true" />
            {t.deleteLayer}
          </button>
        )}
      </div>
      {layer.audience === "public" && layer.reviewStatus !== "approved" && (
        <p className="fine-print">
          {layer.reviewStatus === "pending"
            ? t.pendingReview
            : layer.reviewStatus === "rejected"
              ? t.rejected
              : t.statusHidden}{" "}
          · {t.publishNote}
        </p>
      )}
      {confirming && (
        <div
          className="notice notice-warning"
          role="alertdialog"
          aria-label={t.deleteLayer}
        >
          <p>{format(t.confirmDelete, { title: layerTitle(layer, locale) })}</p>
          <div className="actions">
            <button
              type="button"
              className="button small"
              disabled={pending !== null}
              aria-busy={pending === "delete" || undefined}
              onClick={() =>
                run(
                  "delete",
                  () => api(`layers/${layer.id}`, "DELETE"),
                  () => router.push("/layers?tab=mine"),
                )
              }
            >
              {t.remove}
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => setConfirming(false)}
            >
              {t.close}
            </button>
          </div>
        </div>
      )}
      <StatusMessage feedback={feedback} />
    </div>
  );
}
export function CreateLayerLink({
  t,
  authenticated,
  href = "/layers/new",
}: {
  t: Copy;
  authenticated: boolean;
  href?: string;
}) {
  return (
    <Link
      className="button"
      href={authenticated ? href : `/sign-in?next=${encodeURIComponent(href)}`}
    >
      <Plus size={16} aria-hidden="true" />
      {t.createLayer}
    </Link>
  );
}
