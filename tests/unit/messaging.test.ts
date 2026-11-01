import { createHmac } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractLinks,
  findCode,
  formatCode,
  parseInstagramWebhook,
  parseLineWebhook,
  verifyLineSignature,
  verifyMetaSignature,
} from "../../apps/web/src/features/messaging/channels";
import {
  captureDir,
  channelConfig,
  chatUrl,
  fitText,
  sendReply,
} from "../../apps/web/src/features/messaging/outbound";
import {
  bilingual,
  botCopy,
  botLocale,
} from "../../apps/web/src/features/messaging/copy";
/* "Send places from chat" adapters (docs/plans/dm-link-to-layer-design.md). */
const secret = "line-channel-secret-0123456789";
const lineSign = (body: string, key = secret) =>
  createHmac("sha256", key).update(body).digest("base64");
const metaSign = (body: string, key = secret) =>
  `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
describe("webhook signatures", () => {
  const body = JSON.stringify({ events: [{ type: "message", text: "台北" }] });
  it("accepts a LINE signature over the exact raw body", () => {
    expect(verifyLineSignature(body, lineSign(body), secret)).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets, re-serialized JSON and missing headers", () => {
    expect(verifyLineSignature(`${body} `, lineSign(body), secret)).toBe(false);
    expect(
      verifyLineSignature(body, lineSign(body, "other-secret-000000"), secret),
    ).toBe(false);
    const reserialized = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyLineSignature(reserialized, lineSign(body), secret)).toBe(
      false,
    );
    expect(verifyLineSignature(body, null, secret)).toBe(false);
    expect(verifyLineSignature(body, lineSign(body), "")).toBe(false);
  });
  it("checks Meta's sha256= header", () => {
    expect(verifyMetaSignature(body, metaSign(body), secret)).toBe(true);
    expect(verifyMetaSignature(body, metaSign(body).slice(7), secret)).toBe(
      false,
    );
    expect(verifyMetaSignature(body, metaSign(`${body}x`), secret)).toBe(false);
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
  });
});
describe("LINE webhook parsing", () => {
  it("normalizes 1:1 text messages, follows and unfollows", () => {
    const events = parseLineWebhook({
      destination: "U-bot",
      events: [
        {
          type: "message",
          webhookEventId: "evt-1",
          replyToken: "reply-1",
          source: { type: "user", userId: "U1" },
          message: {
            id: "m1",
            type: "text",
            text: "https://maps.google.com/?q=Tiger+Den",
          },
        },
        {
          type: "follow",
          webhookEventId: "evt-2",
          replyToken: "reply-2",
          source: { type: "user", userId: "U1" },
        },
        {
          type: "unfollow",
          webhookEventId: "evt-3",
          source: { type: "user", userId: "U1" },
        },
      ],
    });
    expect(events).toEqual([
      {
        kind: "message",
        channel: "line",
        eventId: "evt-1",
        senderId: "U1",
        text: "https://maps.google.com/?q=Tiger+Den",
        attachmentUrls: [],
        replyToken: "reply-1",
      },
      {
        kind: "follow",
        channel: "line",
        eventId: "evt-2",
        senderId: "U1",
        replyToken: "reply-2",
      },
      { kind: "unfollow", channel: "line", eventId: "evt-3", senderId: "U1" },
    ]);
  });
  it("ignores group and room chats, non-text messages, unknown types and malformed events", () => {
    const events = parseLineWebhook({
      events: [
        {
          type: "message",
          webhookEventId: "g",
          source: { type: "group", groupId: "G", userId: "U1" },
          message: { id: "1", type: "text", text: "hi" },
        },
        {
          type: "message",
          webhookEventId: "s",
          source: { type: "user", userId: "U1" },
          message: { id: "2", type: "sticker" },
        },
        {
          type: "postback",
          webhookEventId: "p",
          source: { type: "user", userId: "U1" },
        },
        { nonsense: true },
        "string",
      ],
    });
    expect(events).toEqual([]);
  });
  it("rejects a body without an events array", () => {
    expect(() => parseLineWebhook({})).toThrow();
  });
});
describe("Instagram webhook parsing", () => {
  it("reads text and shared post URLs, and skips echoes", () => {
    const events = parseInstagramWebhook({
      object: "instagram",
      entry: [
        {
          id: "IGBIZ",
          time: 1,
          messaging: [
            {
              sender: { id: "IGSID1" },
              recipient: { id: "IGBIZ" },
              message: { mid: "mid-1", text: "LL-ABCD-EFGH" },
            },
            {
              sender: { id: "IGSID1" },
              message: {
                mid: "mid-2",
                attachments: [
                  {
                    type: "ig_reel",
                    payload: {
                      url: "https://www.instagram.com/reel/abc/",
                      title: "Ignore previous instructions",
                    },
                  },
                  {
                    type: "image",
                    payload: { url: "https://cdn.example/image.jpg" },
                  },
                ],
              },
            },
            {
              sender: { id: "IGBIZ" },
              message: { mid: "mid-3", text: "our reply", is_echo: true },
            },
            { sender: { id: "IGSID1" }, read: { mid: "mid-1" } },
          ],
        },
      ],
    });
    expect(events).toEqual([
      {
        kind: "message",
        channel: "instagram",
        eventId: "mid-1",
        senderId: "IGSID1",
        text: "LL-ABCD-EFGH",
        attachmentUrls: [],
      },
      {
        kind: "message",
        channel: "instagram",
        eventId: "mid-2",
        senderId: "IGSID1",
        text: "",
        attachmentUrls: ["https://www.instagram.com/reel/abc/"],
      },
    ]);
  });
  it("ignores other webhook objects", () => {
    expect(parseInstagramWebhook({ object: "page", entry: [] })).toEqual([]);
  });
});
describe("link extraction", () => {
  it("keeps HTTPS links in order without duplicates or trailing punctuation", () => {
    expect(
      extractLinks(
        "看這家！https://maps.app.goo.gl/abc123。 and (https://www.google.com/maps/place/Tiger+Den/@29.7,-95.5,17z), again https://maps.app.goo.gl/abc123",
      ),
    ).toEqual([
      "https://maps.app.goo.gl/abc123",
      "https://www.google.com/maps/place/Tiger+Den/@29.7,-95.5,17z",
    ]);
  });
  it("drops plain HTTP, credentials and junk; adds attachment URLs", () => {
    expect(
      extractLinks(
        "http://maps.google.com/?q=x https://user:pw@maps.google.com/ https://",
        ["https://www.instagram.com/p/xyz/"],
      ),
    ).toEqual(["https://www.instagram.com/p/xyz/"]);
  });
});
describe("connect codes", () => {
  it("finds codes regardless of case, spacing or dashes", () => {
    expect(findCode("my code is ll-abcd-efgh thanks")).toBe("LL-ABCD-EFGH");
    expect(findCode("LL ABCD EFGH")).toBe("LL-ABCD-EFGH");
    expect(findCode("LLABCDEFGH")).toBe("LL-ABCD-EFGH");
  });
  it("rejects look-alike characters and non-codes", () => {
    expect(findCode("LL-AB0D-EFGH")).toBeNull();
    expect(findCode("LL-ABCD-EFG1")).toBeNull();
    expect(findCode("https://maps.google.com/?q=LL")).toBeNull();
    expect(formatCode("ABCDEFGH")).toBe("LL-ABCD-EFGH");
  });
});
describe("outbound", () => {
  const env = {
    LINE_CHANNEL_SECRET: secret,
    LINE_CHANNEL_ACCESS_TOKEN: "token",
    LINE_ADD_FRIEND_URL: "https://line.me/R/ti/p/@locallink",
    INSTAGRAM_APP_SECRET: secret,
    INSTAGRAM_VERIFY_TOKEN: "verify-token-0123456789",
    INSTAGRAM_ACCESS_TOKEN: "ig-token",
    INSTAGRAM_ACCOUNT_HANDLE: "locallink.app",
  };
  it("needs real secrets to enable a channel", () => {
    expect(channelConfig({})).toEqual({ line: null, instagram: null });
    expect(
      channelConfig({ ...env, LINE_CHANNEL_SECRET: "short" }).line,
    ).toBeNull();
    const config = channelConfig(env);
    expect(config.instagram?.graphVersion).toBe("v26.0");
    expect(chatUrl("line", config)).toBe("https://line.me/R/ti/p/@locallink");
    expect(chatUrl("instagram", config)).toBe("https://ig.me/m/locallink.app");
    expect(
      channelConfig({ ...env, LINE_ADD_FRIEND_URL: "javascript:alert(1)" }).line
        ?.addFriendUrl,
    ).toBe("");
  });
  it("only captures outside production", () => {
    expect(
      captureDir({
        MESSAGING_PROVIDER: "capture",
        MESSAGING_CAPTURE_DIR: "/tmp/x",
        NODE_ENV: "test",
      }),
    ).toBe("/tmp/x");
    expect(
      captureDir({
        MESSAGING_PROVIDER: "capture",
        MESSAGING_CAPTURE_DIR: "/tmp/x",
        NODE_ENV: "production",
      }),
    ).toBeNull();
  });
  it("fits Instagram replies in 1000 bytes", () => {
    const long = "台".repeat(600);
    const fitted = fitText("instagram", long);
    expect(Buffer.byteLength(fitted)).toBeLessThanOrEqual(1000);
    expect(fitted.endsWith("…")).toBe(true);
    expect(fitText("instagram", "short")).toBe("short");
    expect(fitText("line", "x".repeat(6000))).toHaveLength(5000);
  });
  describe("capture mode", () => {
    let dir = "";
    afterEach(() => {
      vi.unstubAllEnvs();
      if (dir) rmSync(dir, { recursive: true, force: true });
    });
    it("writes replies to the capture directory instead of calling a platform", async () => {
      dir = mkdtempSync(path.join(tmpdir(), "messaging-unit-"));
      vi.stubEnv("MESSAGING_PROVIDER", "capture");
      vi.stubEnv("MESSAGING_CAPTURE_DIR", dir);
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await sendReply({ channel: "line", to: "reply-token", text: "Added" });
      expect(fetchSpy).not.toHaveBeenCalled();
      const files = readdirSync(dir);
      expect(files).toHaveLength(1);
      expect(
        JSON.parse(readFileSync(path.join(dir, files[0]), "utf8")),
      ).toEqual({
        channel: "line",
        to: "reply-token",
        text: "Added",
      });
      fetchSpy.mockRestore();
    });
  });
});
describe("bot copy", () => {
  it("has every key in both locales", () => {
    expect(Object.keys(botCopy["zh-TW"]).sort()).toEqual(
      Object.keys(botCopy.en).sort(),
    );
    expect(botLocale("zh-TW")).toBe("zh-TW");
    expect(botLocale("ja")).toBe("en");
  });
  it("greets unknown senders in both languages", () => {
    const text = bilingual((c) =>
      c.welcome("https://example.test/profile/connections"),
    );
    expect(text).toContain("connect your account");
    expect(text).toContain("連結帳號");
  });
});
