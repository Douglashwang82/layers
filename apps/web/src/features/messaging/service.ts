import { createHmac, randomInt } from "node:crypto";
import { pool } from "@taiwanhub/database";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  AppError,
  requireActor,
  type Actor,
  type GoogleLinkResult,
  type Role,
} from "@taiwanhub/shared";
import { appUrl, flags } from "@/lib/config";
import { isAdmitted } from "@/features/membership/repository";
import {
  getLayer,
  listEditableLayers,
  requireEditableLayer,
} from "@/features/layers/repository";
import { insertLayer, notProjected } from "@/features/layers/service";
import {
  importGooglePlaces,
  resolveGoogleLinks,
} from "@/features/google-links/service";
import {
  channels,
  codeAlphabet,
  extractLinks,
  findCode,
  formatCode,
  maxLinksPerMessage,
  type Channel,
  type InboundEvent,
} from "./channels";
import { bilingual, botCopy, botLocale } from "./copy";
import { channelConfig, chatUrl, sendReply, type Sender } from "./outbound";
/*
 * "Send places from chat" (docs/plans/dm-link-to-layer-design.md). A member
 * connects a LINE or Instagram chat with a one-time code confirmed on the
 * web, chooses a layer, and every Google Maps link they send in that chat is
 * added to it through the same resolver and import used by the web editor.
 * The actor is always derived from the stored binding, never from message
 * content, and every write rechecks edit rights on the server.
 */
export const codeTtlMinutes = 10;
export const connectLimits = {
  codesPerHour: 10,
  codeTriesPerSender: 10,
  onboardingRepliesPerSender: 1,
};
export function chatCaptureEnabled() {
  return flags.chatCapture && flags.mapMvp && flags.layerWrites;
}
function enabled() {
  if (!chatCaptureEnabled())
    throw new AppError(
      404,
      "DISABLED",
      "Sending places from chat is unavailable.",
    );
}
let hashKey: Buffer | null = null;
function key() {
  if (hashKey) return hashKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production")
    throw new Error("AUTH_SECRET is required for chat connections.");
  hashKey = createHmac("sha256", secret || "taiwanhub-local-development")
    .update("taiwanhub:messaging-id:v1")
    .digest();
  return hashKey;
}
/** Keyed hash of a platform sender ID; the raw ID is never stored. */
export function senderHash(channel: Channel, senderId: string) {
  return createHmac("sha256", key())
    .update(`sender\u0000${channel}\u0000${senderId}`)
    .digest("base64url");
}
function codeHash(channel: Channel, code: string) {
  return createHmac("sha256", key())
    .update(`code\u0000${channel}\u0000${code}`)
    .digest("base64url");
}
export const connectionsUrl = () => `${appUrl}/profile/connections`;
export const layerUrl = (slug: string) =>
  `${appUrl}/?layerPanel=detail&layer=${encodeURIComponent(slug)}`;
/** Counts one hit against a window; true while under the limit. */
async function underLimit(key: string, max: number, minutes: number) {
  const result = await pool.query<{ count: number }>(
    `INSERT INTO rate_limit(key,count,expires_at) VALUES($1,1,now()+make_interval(mins=>$2::int))
     ON CONFLICT(key) DO UPDATE SET
       count=CASE WHEN rate_limit.expires_at<now() THEN 1 ELSE rate_limit.count+1 END,
       expires_at=CASE WHEN rate_limit.expires_at<now() THEN now()+make_interval(mins=>$2::int) ELSE rate_limit.expires_at END
     RETURNING count`,
    [key, minutes],
  );
  return result.rows[0].count <= max;
}
async function transaction<T>(fn: (tx: PoolClient) => Promise<T>) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
}
type LinkRow = {
  id: string;
  user_id: string;
  channel: Channel;
  status: "active" | "pending_confirm";
  default_layer_id: string | null;
  inbox_layer_id: string | null;
};
const channelInput = z.enum(channels);
/* ---------------------------- Web (session) side --------------------------- */
export async function listConnections(actor: Actor | null) {
  enabled();
  const a = requireActor(actor);
  const config = channelConfig();
  const [links, receipts, layers] = await Promise.all([
    pool.query<LinkRow & { last_used_at: Date | null; created_at: Date }>(
      "SELECT id,user_id,channel,status,default_layer_id,inbox_layer_id,last_used_at,created_at FROM messaging_link WHERE user_id=$1",
      [a.id],
    ),
    pool.query<{
      channel: Channel;
      source_url: string | null;
      outcome: string;
      added: number;
      received_at: Date;
      layer_title: string | null;
      layer_slug: string | null;
    }>(
      `SELECT r.channel,r.source_url,r.outcome,r.added,r.received_at,l.title AS layer_title,l.slug AS layer_slug
       FROM messaging_receipt r LEFT JOIN layer l ON l.id=r.layer_id
       WHERE r.user_id=$1 AND r.source_url IS NOT NULL AND r.received_at>now()-interval '30 days'
       ORDER BY r.received_at DESC LIMIT 20`,
      [a.id],
    ),
    listEditableLayers(a),
  ]);
  return {
    connections: channels.map((channel) => {
      const link = links.rows.find((r) => r.channel === channel);
      return {
        channel,
        configured: Boolean(config[channel]),
        chatUrl: chatUrl(channel, config),
        status: link?.status ?? "none",
        defaultLayerId: link?.default_layer_id ?? null,
        inboxLayerId: link?.inbox_layer_id ?? null,
        connectedAt: link?.created_at ?? null,
        lastUsedAt: link?.last_used_at ?? null,
      };
    }),
    // Public layers are never offered: a chat message must not publish.
    layers: layers
      .filter((l) => l.audience !== "public" && l.ownerKind !== "system")
      .map((l) => ({
        id: l.id,
        title: l.title,
        titleChinese: l.titleChinese,
        audience: l.audience,
      })),
    recent: receipts.rows.map((r) => ({
      channel: r.channel,
      sourceUrl: r.source_url,
      outcome: r.outcome,
      added: r.added,
      receivedAt: r.received_at,
      layerTitle: r.layer_title,
      layerSlug: r.layer_slug,
    })),
  };
}
export function generateCode() {
  let raw = "";
  for (let i = 0; i < 8; i++)
    raw += codeAlphabet[randomInt(codeAlphabet.length)];
  return formatCode(raw);
}
/** A fresh single-use code; earlier unused codes for this channel stop working. */
export async function createConnectCode(
  actor: Actor | null,
  channelRaw: unknown,
) {
  enabled();
  const a = requireActor(actor);
  const channel = channelInput.parse(channelRaw);
  if (!channelConfig()[channel])
    throw new AppError(503, "UNAVAILABLE", "This chat app isn't set up yet.");
  if (
    !(await underLimit(
      `messaging-code:${a.id}`,
      connectLimits.codesPerHour,
      60,
    ))
  )
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before getting another code.",
    );
  const code = generateCode();
  const expiresAt = await transaction(async (tx) => {
    await tx.query(
      "DELETE FROM messaging_link_attempt WHERE user_id=$1 AND channel=$2 AND consumed_at IS NULL",
      [a.id, channel],
    );
    const inserted = await tx.query<{ expires_at: Date }>(
      `INSERT INTO messaging_link_attempt(user_id,channel,secret_hash,expires_at)
       VALUES($1,$2,$3,now()+make_interval(mins=>$4::int)) RETURNING expires_at`,
      [a.id, channel, codeHash(channel, code), codeTtlMinutes],
    );
    return inserted.rows[0].expires_at;
  });
  return { channel, code, expiresAt, chatUrl: chatUrl(channel) };
}
/** Confirms a binding the code created; only the account that made the code can. */
export async function confirmConnection(
  actor: Actor | null,
  channelRaw: unknown,
) {
  enabled();
  const a = requireActor(actor);
  const channel = channelInput.parse(channelRaw);
  const result = await pool.query(
    "UPDATE messaging_link SET status='active',updated_at=now() WHERE user_id=$1 AND channel=$2 AND status='pending_confirm' RETURNING id",
    [a.id, channel],
  );
  if (!result.rows[0])
    throw new AppError(
      404,
      "NOT_FOUND",
      "There is no connection waiting for you to confirm.",
    );
  return { channel, status: "active" };
}
export async function disconnect(actor: Actor | null, channelRaw: unknown) {
  enabled();
  const a = requireActor(actor);
  const channel = channelInput.parse(channelRaw);
  await pool.query(
    "DELETE FROM messaging_link WHERE user_id=$1 AND channel=$2",
    [a.id, channel],
  );
  await pool.query(
    "DELETE FROM messaging_link_attempt WHERE user_id=$1 AND channel=$2",
    [a.id, channel],
  );
  return { channel, status: "none" };
}
const destinationInput = z.object({ defaultLayerId: z.uuid().nullable() });
/** Where places sent from this chat go. null means the private Inbox. */
export async function setDestination(
  actor: Actor | null,
  channelRaw: unknown,
  body: unknown,
) {
  enabled();
  const a = requireActor(actor);
  const channel = channelInput.parse(channelRaw);
  const { defaultLayerId } = destinationInput.parse(body);
  if (defaultLayerId) {
    const found = await requireEditableLayer(defaultLayerId, a);
    notProjected(found);
    if (found.layer.audience === "public")
      throw new AppError(
        400,
        "PUBLIC_LAYER",
        "Places from chat can't go straight into a public layer.",
      );
  }
  const result = await pool.query(
    "UPDATE messaging_link SET default_layer_id=$3,updated_at=now() WHERE user_id=$1 AND channel=$2 RETURNING id",
    [a.id, channel, defaultLayerId],
  );
  if (!result.rows[0])
    throw new AppError(404, "NOT_FOUND", "Connect this chat app first.");
  return { channel, defaultLayerId };
}
/* ------------------------------ Webhook side ------------------------------- */
export type WebhookDeps = {
  send: Sender;
  resolve: typeof resolveGoogleLinks;
  importPlaces: typeof importGooglePlaces;
};
export const defaultDeps: WebhookDeps = {
  send: sendReply,
  resolve: resolveGoogleLinks,
  importPlaces: importGooglePlaces,
};
/** Handles events one at a time; one failure never stops the rest. */
export async function handleEvents(events: InboundEvent[], deps = defaultDeps) {
  for (const event of events) {
    try {
      await handleEvent(event, deps);
    } catch (error) {
      // No message text or sender IDs in logs.
      console.error(
        `messaging: ${event.channel} ${event.kind} event failed`,
        error instanceof Error ? error.name : "unknown",
      );
    }
  }
}
export async function handleEvent(event: InboundEvent, deps = defaultDeps) {
  const hash = senderHash(event.channel, event.senderId);
  if (event.kind === "unfollow") {
    // Blocking the account ends the connection.
    await pool.query(
      "DELETE FROM messaging_link WHERE channel=$1 AND external_id_hash=$2",
      [event.channel, hash],
    );
    return;
  }
  // Redelivered events stop here.
  const receipt = await pool.query<{ id: string }>(
    "INSERT INTO messaging_receipt(channel,event_id) VALUES($1,$2) ON CONFLICT(channel,event_id) DO NOTHING RETURNING id",
    [event.channel, event.eventId],
  );
  const receiptId = receipt.rows[0]?.id;
  if (!receiptId) return;
  const replyTo = event.channel === "line" ? event.replyToken : event.senderId;
  const reply = async (text: string) => {
    if (replyTo) await deps.send({ channel: event.channel, to: replyTo, text });
  };
  const link = (
    await pool.query<LinkRow>(
      "SELECT id,user_id,channel,status,default_layer_id,inbox_layer_id FROM messaging_link WHERE channel=$1 AND external_id_hash=$2",
      [event.channel, hash],
    )
  ).rows[0];
  if (event.kind === "follow") {
    if (!link) await reply(bilingual((c) => c.welcome(connectionsUrl())));
    return;
  }
  const code = findCode(event.text);
  if (code) {
    await connectWithCode(event.channel, hash, code, link, reply);
    return;
  }
  if (!link) {
    // One onboarding reply per sender per ten minutes stops loops and spam.
    if (
      await underLimit(
        `messaging-onboard:${hash}`,
        connectLimits.onboardingRepliesPerSender,
        10,
      )
    )
      await reply(bilingual((c) => c.welcome(connectionsUrl())));
    return;
  }
  const user = (
    await pool.query<{ role: Role; preferred_language: string }>(
      'SELECT role,preferred_language FROM "user" WHERE id=$1',
      [link.user_id],
    )
  ).rows[0];
  const t = botCopy[botLocale(user?.preferred_language)];
  if (link.status !== "active") {
    await reply(t.pendingStill(connectionsUrl()));
    return;
  }
  if (!user || !(await isAdmitted(link.user_id))) {
    await reply(t.notMember);
    return;
  }
  const actor: Actor = { id: link.user_id, role: user.role };
  await pool.query("UPDATE messaging_receipt SET user_id=$2 WHERE id=$1", [
    receiptId,
    actor.id,
  ]);
  const all = extractLinks(event.text, event.attachmentUrls);
  const target = await resolveTarget(link, actor);
  const layerTitle = (l: { title: string; titleChinese: string }) =>
    botLocale(user.preferred_language) === "zh-TW" && l.titleChinese
      ? l.titleChinese
      : l.title;
  if (!all.length) {
    await reply(t.help(layerTitle(target.layer)));
    return;
  }
  const links = all.slice(0, maxLinksPerMessage);
  const lines: string[] = [];
  if (target.fellBack) lines.push(t.fellBack(layerTitle(target.layer)));
  if (all.length > links.length) lines.push(t.tooMany(maxLinksPerMessage));
  let results: GoogleLinkResult[];
  try {
    results = (await deps.resolve(actor, { links, layerId: target.layer.id }))
      .results as GoogleLinkResult[];
  } catch (error) {
    await reply(
      error instanceof AppError && error.code === "RATE_LIMITED"
        ? t.busy
        : t.unavailable,
    );
    await recordOutcome(receiptId, links[0], target.layer.id, "failed", 0);
    return;
  }
  const maps = results.filter(
    (r) => r.status === "resolved" && r.source !== "instagram",
  );
  const ids = [...new Set(maps.map((r) => r.providerPlaceId!))];
  let added = 0;
  if (ids.length) {
    const names = Object.fromEntries(
      maps.filter((r) => r.name).map((r) => [r.providerPlaceId!, r.name!]),
    );
    const outcome = await deps.importPlaces(actor, target.layer.id, {
      providerPlaceIds: ids,
      linkNames: names,
    });
    added = outcome.added;
    const url = layerUrl(target.layer.slug);
    if (added) {
      const skipped = new Set(outcome.skipped.map((s) => s.providerPlaceId));
      const shown = ids
        .filter((id) => !skipped.has(id))
        .map((id) => names[id] ?? "1 place");
      lines.push(t.added(shown, layerTitle(target.layer), url));
    } else lines.push(t.duplicate(layerTitle(target.layer), url));
  }
  // Instagram captions are unverified: never added from chat, only reported.
  const instagram = results.filter((r) => r.source === "instagram");
  const igNames = instagram
    .filter((r) => r.status === "resolved" && r.name)
    .map((r) => r.name!);
  if (igNames.length)
    lines.push(t.instagramFound(igNames, layerUrl(target.layer.slug)));
  else if (instagram.length) lines.push(t.instagramNotFound);
  const other = results.filter(
    (r) => r.source !== "instagram" && r.status !== "resolved",
  );
  if (other.some((r) => r.reason === "list")) lines.push(t.unsupportedList);
  else if (other.length && !ids.length) lines.push(t.notFound);
  await recordOutcome(
    receiptId,
    links[0],
    target.layer.id,
    added ? "added" : ids.length ? "duplicate" : "not_found",
    added,
  );
  await pool.query("UPDATE messaging_link SET last_used_at=now() WHERE id=$1", [
    link.id,
  ]);
  await reply(lines.join("\n\n"));
}
async function recordOutcome(
  receiptId: string,
  sourceUrl: string,
  layerId: string,
  outcome: string,
  added: number,
) {
  await pool.query(
    "UPDATE messaging_receipt SET source_url=$2,layer_id=$3,outcome=$4,added=$5 WHERE id=$1",
    [receiptId, sourceUrl.slice(0, 2000), layerId, outcome, added],
  );
}
async function connectWithCode(
  channel: Channel,
  hash: string,
  code: string,
  existing: LinkRow | undefined,
  reply: (text: string) => Promise<void>,
) {
  if (
    !(await underLimit(
      `messaging-code-try:${hash}`,
      connectLimits.codeTriesPerSender,
      10,
    ))
  ) {
    await reply(bilingual((c) => c.busy));
    return;
  }
  const outcome = await transaction(async (tx) => {
    const attempt = (
      await tx.query<{ id: string; user_id: string }>(
        `UPDATE messaging_link_attempt SET consumed_at=now()
         WHERE secret_hash=$1 AND channel=$2 AND consumed_at IS NULL AND expires_at>now()
         RETURNING id,user_id`,
        [codeHash(channel, code), channel],
      )
    ).rows[0];
    if (!attempt) return { kind: "unknown" as const };
    if (
      existing &&
      existing.user_id !== attempt.user_id &&
      existing.status === "active"
    )
      return { kind: "taken" as const, userId: attempt.user_id };
    // One chat per account per app, and one account per chat.
    await tx.query(
      "DELETE FROM messaging_link WHERE channel=$1 AND (user_id=$2 OR external_id_hash=$3)",
      [channel, attempt.user_id, hash],
    );
    await tx.query(
      "INSERT INTO messaging_link(user_id,channel,external_id_hash,status) VALUES($1,$2,$3,'pending_confirm')",
      [attempt.user_id, channel, hash],
    );
    return { kind: "pending" as const, userId: attempt.user_id };
  });
  if (outcome.kind === "unknown") {
    await reply(bilingual((c) => c.codeUnknown(connectionsUrl())));
    return;
  }
  const language = (
    await pool.query<{ preferred_language: string }>(
      'SELECT preferred_language FROM "user" WHERE id=$1',
      [outcome.userId],
    )
  ).rows[0]?.preferred_language;
  const t = botCopy[botLocale(language)];
  await reply(
    outcome.kind === "taken" ? t.codeTaken : t.pending(connectionsUrl()),
  );
}
type Target = {
  layer: { id: string; slug: string; title: string; titleChinese: string };
  fellBack: boolean;
};
/**
 * The chosen layer while the member can still edit it and it is not public;
 * otherwise their private Inbox, created on first use.
 */
async function resolveTarget(link: LinkRow, actor: Actor): Promise<Target> {
  const usable = async (id: string | null) => {
    if (!id) return null;
    const found = await getLayer(id, actor);
    if (
      !found?.access.edit ||
      found.layer.audience === "public" ||
      found.layer.ownerKind === "system" ||
      found.layer.lifecycle === "archived"
    )
      return null;
    return found.layer;
  };
  const chosen = await usable(link.default_layer_id);
  if (chosen) return { layer: chosen, fellBack: false };
  const inbox =
    (await usable(link.inbox_layer_id)) ?? (await createInbox(link, actor));
  return { layer: inbox, fellBack: Boolean(link.default_layer_id) };
}
async function createInbox(link: LinkRow, actor: Actor) {
  const id = await transaction(async (tx) => {
    // Serialize concurrent messages so only one Inbox is made.
    const locked = (
      await tx.query<{ inbox_layer_id: string | null }>(
        "SELECT inbox_layer_id FROM messaging_link WHERE id=$1 FOR UPDATE",
        [link.id],
      )
    ).rows[0];
    if (locked?.inbox_layer_id && locked.inbox_layer_id !== link.inbox_layer_id)
      return locked.inbox_layer_id;
    const city = (
      await tx.query<{ slug: string }>(
        `SELECT c.slug FROM city c LEFT JOIN "user" u ON u.home_city_id=c.id AND u.id=$1
         ORDER BY (u.id IS NOT NULL) DESC, c.name LIMIT 1`,
        [actor.id],
      )
    ).rows[0];
    if (!city) throw new AppError(503, "UNAVAILABLE", "No city is configured.");
    const layer = await insertLayer(tx, actor, {
      title: "Inbox",
      titleChinese: "收件匣",
      description: "Places you sent from chat.",
      descriptionChinese: "",
      city: city.slug,
      audience: "private",
      schedule: "evergreen",
    });
    await tx.query("UPDATE layer SET lifecycle='active' WHERE id=$1", [
      layer.id,
    ]);
    await tx.query(
      "UPDATE messaging_link SET inbox_layer_id=$2,updated_at=now() WHERE id=$1",
      [link.id, layer.id],
    );
    return layer.id as string;
  });
  const found = await getLayer(id, actor);
  if (!found)
    throw new AppError(500, "INBOX_FAILED", "Could not create the Inbox.");
  return found.layer;
}
