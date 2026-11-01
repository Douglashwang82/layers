import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
/*
 * Channel adapters for "Send places from chat"
 * (docs/plans/dm-link-to-layer-design.md). Pure functions: webhook signature
 * checks over the raw body, Zod parsing of the platform payloads into one
 * normalized message shape, and URL extraction. Message text is untrusted
 * input: it is only scanned for links and a connect code, never interpreted.
 */
export type Channel = "line" | "instagram";
export const channels: Channel[] = ["line", "instagram"];
export type InboundEvent =
  | {
      kind: "message";
      channel: Channel;
      eventId: string;
      senderId: string;
      text: string;
      /** URLs from shared attachments (Instagram shares carry only a URL). */
      attachmentUrls: string[];
      replyToken?: string;
    }
  | {
      kind: "follow";
      channel: Channel;
      eventId: string;
      senderId: string;
      replyToken?: string;
    }
  | { kind: "unfollow"; channel: Channel; eventId: string; senderId: string };
/** Raw webhook bodies larger than this are rejected before verification. */
export const maxWebhookBytes = 256 * 1024;
/** Links read from one message; more than this are ignored and reported. */
export const maxLinksPerMessage = 3;
function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
/** LINE: base64 HMAC-SHA256 of the raw body with the channel secret. */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
) {
  if (!signature || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret)
    .update(rawBody, "utf8")
    .digest("base64");
  return safeEqual(expected, signature);
}
/** Meta (Instagram): `sha256=` + hex HMAC-SHA256 of the raw body with the app secret. */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
) {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(`sha256=${expected}`, header);
}
const id = z.string().min(1).max(200);
const lineEvent = z.looseObject({
  type: z.string(),
  webhookEventId: id.optional(),
  replyToken: z.string().max(200).optional(),
  source: z.looseObject({ type: z.string(), userId: id.optional() }).optional(),
  message: z
    .looseObject({
      id,
      type: z.string(),
      text: z.string().max(5000).optional(),
    })
    .optional(),
});
const lineBody = z.looseObject({ events: z.array(z.unknown()).max(100) });
/**
 * Only 1:1 chats with a user are handled: group and room events carry other
 * people's messages and are ignored, as are event types we do not use.
 */
export function parseLineWebhook(body: unknown): InboundEvent[] {
  const events: InboundEvent[] = [];
  for (const raw of lineBody.parse(body).events) {
    const parsed = lineEvent.safeParse(raw);
    if (!parsed.success) continue;
    const e = parsed.data;
    const senderId = e.source?.type === "user" ? e.source.userId : undefined;
    if (!senderId) continue;
    const eventId = e.webhookEventId ?? e.message?.id;
    if (!eventId) continue;
    const base = { channel: "line" as const, eventId, senderId };
    if (e.type === "message" && e.message?.type === "text")
      events.push({
        ...base,
        kind: "message",
        text: e.message.text ?? "",
        attachmentUrls: [],
        replyToken: e.replyToken,
      });
    else if (e.type === "follow")
      events.push({ ...base, kind: "follow", replyToken: e.replyToken });
    else if (e.type === "unfollow") events.push({ ...base, kind: "unfollow" });
  }
  return events;
}
const instagramAttachment = z.looseObject({
  type: z.string(),
  payload: z.looseObject({ url: z.string().max(2000).optional() }).optional(),
});
const instagramMessaging = z.looseObject({
  sender: z.looseObject({ id }),
  recipient: z.looseObject({ id }).optional(),
  message: z
    .looseObject({
      mid: id,
      text: z.string().max(5000).optional(),
      is_echo: z.boolean().optional(),
      attachments: z.array(z.unknown()).max(10).optional(),
    })
    .optional(),
});
const instagramBody = z.looseObject({
  object: z.string(),
  entry: z
    .array(
      z.looseObject({ messaging: z.array(z.unknown()).max(100).optional() }),
    )
    .max(100),
});
/** Shared posts and reels arrive as attachments that carry only a URL. */
const sharedTypes = new Set(["share", "ig_post", "ig_reel"]);
export function parseInstagramWebhook(body: unknown): InboundEvent[] {
  const parsed = instagramBody.parse(body);
  if (parsed.object !== "instagram") return [];
  const events: InboundEvent[] = [];
  for (const entry of parsed.entry)
    for (const raw of entry.messaging ?? []) {
      const m = instagramMessaging.safeParse(raw);
      // Echoes are our own replies; skip them so the bot never answers itself.
      if (!m.success || !m.data.message || m.data.message.is_echo) continue;
      const attachmentUrls: string[] = [];
      for (const a of m.data.message.attachments ?? []) {
        const att = instagramAttachment.safeParse(a);
        if (
          att.success &&
          sharedTypes.has(att.data.type) &&
          att.data.payload?.url
        )
          attachmentUrls.push(att.data.payload.url);
      }
      events.push({
        kind: "message",
        channel: "instagram",
        eventId: m.data.message.mid,
        senderId: m.data.sender.id,
        text: m.data.message.text ?? "",
        attachmentUrls,
      });
    }
  return events;
}
/**
 * HTTPS URLs from a message, in order, without duplicates or trailing
 * punctuation. Anything else in the text is ignored.
 */
export function extractLinks(text: string, extra: string[] = []) {
  const found: string[] = [];
  const candidates = [
    ...(text.match(/https:\/\/[^\s<>"'`]+/gi) ?? []),
    ...extra,
  ];
  for (const raw of candidates) {
    const trimmed = raw.replace(/[)\].,!?;:，。！？、」』）]+$/u, "");
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      const value = url.toString();
      if (!found.includes(value)) found.push(value);
    } catch {
      // Not a URL; ignore.
    }
  }
  return found;
}
/** Connect codes: `LL-` + 8 characters from an alphabet without look-alikes. */
export const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function formatCode(raw: string) {
  return `LL-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}
/** Finds a connect code in a message, tolerating case, spaces and missing dashes. */
export function findCode(text: string) {
  const match = /\bLL[\s-]?([A-Z0-9]{4})[\s-]?([A-Z0-9]{4})\b/i.exec(text);
  if (!match) return null;
  const raw = (match[1] + match[2]).toUpperCase();
  return [...raw].every((c) => codeAlphabet.includes(c))
    ? formatCode(raw)
    : null;
}
