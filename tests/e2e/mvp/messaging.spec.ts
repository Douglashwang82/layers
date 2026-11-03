import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { createAndSignIn } from "../fixtures";
import { e2eMessaging, messagingCaptureDir } from "./messaging-env";
/*
 * Send places from chat (docs/plans/dm-link-to-layer-design.md). A member
 * connects LINE and Instagram on /profile/connections, DMs our official
 * account (simulated with correctly signed webhook calls), and the place
 * from the shared Google Maps link lands in the layer they chose. Links
 * resolve through the fake resolver; bot replies are captured to files.
 */
const run = Date.now().toString(36);
let seq = 0;
type Captured = { channel: string; to: string; text: string };
function captured(): Captured[] {
  const dir = messagingCaptureDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map(
      (f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Captured,
    );
}
/** Waits for the bot's reply to one message (processing runs after the 200). */
async function replyTo(to: string) {
  let text = "";
  await expect
    .poll(() => (text = captured().find((r) => r.to === to)?.text ?? ""), {
      timeout: 15000,
    })
    .not.toBe("");
  return text;
}
async function sendLine(
  request: APIRequestContext,
  userId: string,
  text: string,
) {
  seq += 1;
  const replyToken = `e2e-reply-${run}-${seq}`;
  const body = JSON.stringify({
    destination: "U-bot",
    events: [
      {
        type: "message",
        mode: "active",
        timestamp: Date.now(),
        webhookEventId: `e2e-${run}-${seq}`,
        deliveryContext: { isRedelivery: false },
        replyToken,
        source: { type: "user", userId },
        message: { id: `m-${run}-${seq}`, type: "text", quoteToken: "q", text },
      },
    ],
  });
  const response = await request.post("/api/webhooks/line", {
    data: body,
    headers: {
      "Content-Type": "application/json",
      "x-line-signature": createHmac("sha256", e2eMessaging.lineSecret)
        .update(body)
        .digest("base64"),
    },
  });
  expect(response.status()).toBe(200);
  return replyTo(replyToken);
}
async function sendInstagram(
  request: APIRequestContext,
  senderId: string,
  text: string,
) {
  seq += 1;
  const body = JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: "IG-BUSINESS",
        time: Date.now(),
        messaging: [
          {
            sender: { id: senderId },
            recipient: { id: "IG-BUSINESS" },
            timestamp: Date.now(),
            message: { mid: `mid-${run}-${seq}`, text },
          },
        ],
      },
    ],
  });
  const before = captured().filter((r) => r.to === senderId).length;
  const response = await request.post("/api/webhooks/instagram", {
    data: body,
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", e2eMessaging.instagramSecret).update(body).digest("hex")}`,
    },
  });
  expect(response.status()).toBe(200);
  // Instagram replies go to the sender ID, so wait for one more of them.
  await expect
    .poll(() => captured().filter((r) => r.to === senderId).length, {
      timeout: 15000,
    })
    .toBe(before + 1);
  return captured()
    .filter((r) => r.to === senderId)
    .at(-1)!.text;
}
async function connect(
  page: Page,
  app: "LINE" | "Instagram",
  send: (text: string) => Promise<string>,
) {
  const section = page.locator("section", {
    has: page.getByRole("heading", { name: new RegExp(`^${app}`) }),
  });
  await expect(section.getByText("Not connected")).toBeVisible();
  await section.getByRole("button", { name: `Connect ${app}` }).click();
  const code = (await section
    .getByTestId(/messaging-code-/)
    .textContent())!.trim();
  expect(code).toMatch(/^LL-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(await send(`my code ${code}`)).toContain("tap Confirm");
  await page.reload();
  await expect(
    section.getByText("Waiting for your confirmation"),
  ).toBeVisible();
  await section.getByRole("button", { name: `Confirm ${app}` }).click();
  await expect(section.getByText("Connected", { exact: true })).toBeVisible();
  return section;
}
test("Instagram webhook verification echoes the challenge only for our token", async ({
  request,
}) => {
  const ok = await request.get(
    `/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${e2eMessaging.instagramVerifyToken}&hub.challenge=1158201444`,
  );
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe("1158201444");
  const bad = await request.get(
    "/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1",
  );
  expect(bad.status()).toBe(403);
  const unsigned = await request.post("/api/webhooks/line", {
    data: JSON.stringify({ events: [] }),
    headers: {
      "Content-Type": "application/json",
      "x-line-signature": "forged",
    },
  });
  expect(unsigned.status()).toBe(401);
});
test("a member DMs Google Maps links on LINE and Instagram and the places land in the chosen layer", async ({
  page,
  request,
}) => {
  await createAndSignIn(page, "Chat Sender", `chat-${run}@example.test`);
  const title = `Chat finds ${run}`;
  const created = await page.request.post("/api/v1/layers", {
    data: { title, city: "houston" },
  });
  expect(created.status()).toBe(201);
  const layer = (await created.json()).data.layer as {
    id: string;
    slug: string;
  };
  const lineUser = `U-e2e-${run}`;
  const igUser = `IG-e2e-${run}`;
  // An unknown sender is told how to connect.
  expect(await sendLine(request, lineUser, "hi")).toContain(
    "connect your account",
  );
  // Profile → Send places from chat.
  await page.goto("/profile");
  await page.getByRole("link", { name: /Send places from chat/ }).click();
  await expect(
    page.getByRole("heading", { name: "Send places from chat" }),
  ).toBeVisible();
  // LINE: connect with a code, confirm on the web, choose the layer.
  const line = await connect(page, "LINE", (text) =>
    sendLine(request, lineUser, text),
  );
  await line
    .getByLabel("Where sent places go")
    .selectOption({ label: `${title} · Private` });
  await expect(page.getByText("Saved.")).toBeVisible();
  const added = await sendLine(
    request,
    lineUser,
    "Saturday lunch? https://www.google.com/maps/place/Tiger+Den/@29.7052,-95.5523,17z",
  );
  expect(added).toContain(`Added Tiger Den to "${title}"`);
  expect(added).toContain(`layer=${layer.slug}`);
  // Instagram: same flow, same layer.
  const instagram = await connect(page, "Instagram", (text) =>
    sendInstagram(request, igUser, text),
  );
  await instagram
    .getByLabel("Where sent places go")
    .selectOption({ label: `${title} · Private` });
  await expect(page.getByText("Saved.")).toBeVisible();
  expect(
    await sendInstagram(
      request,
      igUser,
      "https://maps.google.com/?q=Kim+Son+Restaurant",
    ),
  ).toContain(`Added Kim Son Restaurant to "${title}"`);
  // Recently sent lists both, linking to the layer.
  await page.reload();
  const recent = page.locator(".messaging-recent li");
  await expect(recent).toHaveCount(2);
  await expect(recent.first()).toContainText("Instagram · Added");
  await expect(recent.nth(1)).toContainText("LINE · Added");
  // The layer itself holds both places.
  await page.goto(
    `/?layers=${layer.slug}&layerPanel=contents&layer=${layer.slug}`,
  );
  const places = page.locator(".google-places > li");
  await expect(places).toHaveCount(2);
  await expect(places.first()).toContainText("Tiger Den");
  await expect(places.nth(1)).toContainText("Kim Son Restaurant");
  // Disconnecting stops adding: the next link gets the onboarding reply path.
  await page.goto("/profile/connections");
  await line.getByRole("button", { name: "Disconnect LINE" }).click();
  await expect(line.getByText("Not connected")).toBeVisible();
});
