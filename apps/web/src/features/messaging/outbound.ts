import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loggedFetch } from "@taiwanhub/database";
import type { Channel } from "./channels";
/*
 * Channel configuration and reply clients. Secrets stay server-side. With
 * MESSAGING_PROVIDER=capture (never in production) replies are written as
 * JSON files to MESSAGING_CAPTURE_DIR instead of calling LINE or Meta, which
 * is how unit and browser tests read the bot's answers.
 */
export type ChannelConfig = {
  line: {
    channelSecret: string;
    accessToken: string;
    /** Public add-friend link, e.g. https://line.me/R/ti/p/@locallink */
    addFriendUrl: string;
  } | null;
  instagram: {
    appSecret: string;
    verifyToken: string;
    accessToken: string;
    /** Public handle without "@", for the ig.me link. */
    handle: string;
    graphVersion: string;
  } | null;
};
type Env = Record<string, string | undefined>;
const minSecret = 16;
export function channelConfig(env: Env = process.env): ChannelConfig {
  const line =
    (env.LINE_CHANNEL_SECRET?.length ?? 0) >= minSecret &&
    env.LINE_CHANNEL_ACCESS_TOKEN
      ? {
          channelSecret: env.LINE_CHANNEL_SECRET!,
          accessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
          addFriendUrl: safeHttps(env.LINE_ADD_FRIEND_URL) ?? "",
        }
      : null;
  const instagram =
    (env.INSTAGRAM_APP_SECRET?.length ?? 0) >= minSecret &&
    (env.INSTAGRAM_VERIFY_TOKEN?.length ?? 0) >= minSecret &&
    env.INSTAGRAM_ACCESS_TOKEN
      ? {
          appSecret: env.INSTAGRAM_APP_SECRET!,
          verifyToken: env.INSTAGRAM_VERIFY_TOKEN!,
          accessToken: env.INSTAGRAM_ACCESS_TOKEN,
          handle: (env.INSTAGRAM_ACCOUNT_HANDLE ?? "").replace(
            /[^A-Za-z0-9._]/g,
            "",
          ),
          graphVersion: /^v\d+\.\d+$/.test(env.INSTAGRAM_GRAPH_VERSION ?? "")
            ? env.INSTAGRAM_GRAPH_VERSION!
            : "v26.0",
        }
      : null;
  return { line, instagram };
}
function safeHttps(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
/** Where a sender can open the chat, shown on the connect page. */
export function chatUrl(channel: Channel, config = channelConfig()) {
  if (channel === "line") return config.line?.addFriendUrl || null;
  return config.instagram?.handle
    ? `https://ig.me/m/${config.instagram.handle}`
    : null;
}
export function captureDir(env: Env = process.env) {
  if (env.MESSAGING_PROVIDER !== "capture" || env.NODE_ENV === "production")
    return null;
  return env.MESSAGING_CAPTURE_DIR || null;
}
export type Reply = {
  channel: Channel;
  /** LINE reply token, or the Instagram-scoped sender ID. */
  to: string;
  text: string;
};
/** LINE allows 5000 characters; Instagram 1000 bytes. Trim to fit. */
export function fitText(channel: Channel, text: string) {
  if (channel === "line") return text.slice(0, 5000);
  let out = text;
  while (Buffer.byteLength(out, "utf8") > 1000) out = out.slice(0, -2);
  return out === text ? out : `${out.slice(0, -1)}…`;
}
export type Sender = (reply: Reply) => Promise<void>;
/** Sends one reply. Failures are logged without message text or IDs, never thrown. */
export const sendReply: Sender = async (reply) => {
  const text = fitText(reply.channel, reply.text);
  const dir = captureDir();
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const name = `messaging-${Date.now()}-${crypto.randomUUID()}.json`;
    writeFileSync(path.join(dir, name), JSON.stringify({ ...reply, text }));
    return;
  }
  const config = channelConfig();
  try {
    if (reply.channel === "line" && config.line) {
      const response = await loggedFetch("line", "reply")(
        "https://api.line.me/v2/bot/message/reply",
        {
          method: "POST",
          signal: AbortSignal.timeout(5000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.line.accessToken}`,
          },
          body: JSON.stringify({
            replyToken: reply.to,
            messages: [{ type: "text", text }],
          }),
        },
      );
      if (!response.ok) console.warn(`LINE reply failed: ${response.status}`);
    } else if (reply.channel === "instagram" && config.instagram) {
      const response = await loggedFetch("instagram", "send-message")(
        `https://graph.instagram.com/${config.instagram.graphVersion}/me/messages`,
        {
          method: "POST",
          signal: AbortSignal.timeout(5000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.instagram.accessToken}`,
          },
          body: JSON.stringify({
            recipient: { id: reply.to },
            message: { text },
          }),
        },
      );
      if (!response.ok)
        console.warn(`Instagram reply failed: ${response.status}`);
    }
  } catch {
    console.warn(`${reply.channel} reply failed: network error`);
  }
};
