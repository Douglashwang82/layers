import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";
import {
  confirmConnection,
  createConnectCode,
  defaultDeps,
  disconnect,
  handleEvent,
  listConnections,
  setDestination,
  type WebhookDeps,
} from "../../apps/web/src/features/messaging/service";
import type { InboundEvent } from "../../apps/web/src/features/messaging/channels";
import type { Reply } from "../../apps/web/src/features/messaging/outbound";
import { createLayer } from "../../apps/web/src/features/layers/service";
import { createGroup } from "../../apps/web/src/features/groups/service";
import { flags } from "../../apps/web/src/lib/config";
import { AppError, type Actor } from "../../packages/shared/src";
/*
 * Send places from chat (docs/plans/dm-link-to-layer-design.md): connect a
 * LINE or Instagram chat with a code confirmed on the web, then DM a Google
 * Maps link and find the place in the chosen layer. Google links resolve
 * through the deterministic fake resolver; replies are captured in memory.
 */
const alice: Actor = { id: crypto.randomUUID(), role: "USER" };
const bob: Actor = { id: crypto.randomUUID(), role: "USER" };
const viewer: Actor = { id: crypto.randomUUID(), role: "USER" };
const users = [alice, bob, viewer];
const run = crypto.randomUUID().slice(0, 8);
const flagsBefore = { ...flags };
const envKeys = [
  "GOOGLE_MAPS_LINK_API_KEY",
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_VERIFY_TOKEN",
  "INSTAGRAM_ACCESS_TOKEN",
  "MESSAGING_PROVIDER",
] as const;
const envBefore = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
let replies: Reply[] = [];
const deps: WebhookDeps = {
  ...defaultDeps,
  send: async (reply) => {
    replies.push(reply);
  },
};
let seq = 0;
function message(
  channel: "line" | "instagram",
  senderId: string,
  text: string,
): InboundEvent {
  seq += 1;
  return {
    kind: "message",
    channel,
    eventId: `${run}-${seq}`,
    senderId,
    text,
    attachmentUrls: [],
    replyToken: channel === "line" ? `reply-${run}-${seq}` : undefined,
  };
}
const lastReply = () => replies.at(-1)?.text ?? "";
async function connect(
  actor: Actor,
  channel: "line" | "instagram",
  senderId: string,
) {
  const { code } = await createConnectCode(actor, channel);
  await handleEvent(message(channel, senderId, `here: ${code}`), deps);
  await confirmConnection(actor, channel);
}
async function layerPlaces(layerId: string) {
  const { rows } = await pool.query<{
    provider_place_id: string;
    link_name: string | null;
  }>(
    `SELECT r.provider_place_id,i.link_name FROM layer_item i
     JOIN place_provider_reference r ON r.subject_id=i.subject_id
     WHERE i.layer_id=$1 ORDER BY i.created_at`,
    [layerId],
  );
  return rows;
}
beforeAll(async () => {
  for (const actor of users) {
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [actor.id, "Chat Sender", `${actor.id}@messaging.example`, actor.role],
    );
    await pool.query(
      "INSERT INTO membership_admission(user_id,source) VALUES($1,'legacy')",
      [actor.id],
    );
  }
  Object.assign(flags, { mapMvp: true, layerWrites: true, chatCapture: true });
  process.env.GOOGLE_MAPS_LINK_API_KEY = "fake";
  process.env.LINE_CHANNEL_SECRET = "integration-line-secret-0123456789";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "integration-line-token";
  process.env.INSTAGRAM_APP_SECRET = "integration-ig-secret-0123456789";
  process.env.INSTAGRAM_VERIFY_TOKEN = "integration-ig-verify-0123456789";
  process.env.INSTAGRAM_ACCESS_TOKEN = "integration-ig-token";
});
beforeEach(() => {
  replies = [];
});
afterAll(async () => {
  Object.assign(flags, flagsBefore);
  for (const k of envKeys)
    if (envBefore[k] === undefined) delete process.env[k];
    else process.env[k] = envBefore[k];
  const ids = users.map((u) => u.id);
  await pool.query("DELETE FROM messaging_receipt WHERE event_id LIKE $1", [
    `${run}-%`,
  ]);
  await pool.query(
    "DELETE FROM layer WHERE created_by=ANY($1::uuid[]) OR owner_user_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query('DELETE FROM "group" WHERE created_by=ANY($1::uuid[])', [
    ids,
  ]);
  await pool.query(
    "DELETE FROM membership_admission WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [ids]);
});
describe("connecting a chat", () => {
  it("binds a LINE sender only after the code and a web confirmation", async () => {
    const sender = `U-${run}-alice`;
    await handleEvent(message("line", sender, "hello"), deps);
    expect(lastReply()).toContain("connect your account");
    // Only one onboarding reply per sender per window.
    await handleEvent(message("line", sender, "hello again"), deps);
    expect(replies).toHaveLength(1);
    const { code } = await createConnectCode(alice, "line");
    expect(code).toMatch(/^LL-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await handleEvent(message("line", sender, code.toLowerCase()), deps);
    expect(lastReply()).toContain("tap Confirm");
    expect(replies.at(-1)?.to).toMatch(/^reply-/);
    // Pending: links are not added until confirmed on the web.
    await handleEvent(
      message("line", sender, "https://maps.google.com/?q=Pending+Place"),
      deps,
    );
    expect(lastReply()).toContain("isn't confirmed");
    await confirmConnection(alice, "line");
    const data = await listConnections(alice);
    expect(data.connections.find((c) => c.channel === "line")?.status).toBe(
      "active",
    );
    // Raw sender IDs are never stored.
    const stored = await pool.query(
      "SELECT external_id_hash FROM messaging_link WHERE user_id=$1",
      [alice.id],
    );
    expect(JSON.stringify(stored.rows)).not.toContain(sender);
  });
  it("rejects unknown, reused and expired codes", async () => {
    const sender = `U-${run}-bad`;
    await handleEvent(message("line", sender, "LL-AAAA-BBBB"), deps);
    expect(lastReply()).toContain("didn't work");
    const { code } = await createConnectCode(bob, "line");
    await pool.query(
      "UPDATE messaging_link_attempt SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
      [bob.id],
    );
    await handleEvent(message("line", sender, code), deps);
    expect(lastReply()).toContain("didn't work");
    const fresh = await createConnectCode(bob, "line");
    await handleEvent(message("line", sender, fresh.code), deps);
    expect(lastReply()).toContain("tap Confirm");
    await handleEvent(message("line", `U-${run}-thief`, fresh.code), deps);
    expect(lastReply()).toContain("didn't work");
    await disconnect(bob, "line");
  });
  it("won't move a chat already connected to another account", async () => {
    const sender = `U-${run}-alice`;
    const { code } = await createConnectCode(bob, "line");
    await handleEvent(message("line", sender, code), deps);
    expect(lastReply()).toContain("already connected to another account");
    const link = await pool.query(
      "SELECT user_id FROM messaging_link WHERE user_id=$1",
      [bob.id],
    );
    expect(link.rows).toHaveLength(0);
  });
  it("refuses codes for a channel that isn't configured", async () => {
    const saved = process.env.INSTAGRAM_ACCESS_TOKEN;
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
    await expect(createConnectCode(viewer, "instagram")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    process.env.INSTAGRAM_ACCESS_TOKEN = saved;
  });
});
describe("sending a link adds the place to a layer", () => {
  it("adds to a private Inbox when no layer is chosen", async () => {
    const sender = `U-${run}-alice`;
    await handleEvent(
      message(
        "line",
        sender,
        "Try this https://www.google.com/maps/place/Tiger+Den/@29.7052,-95.5523,17z",
      ),
      deps,
    );
    expect(lastReply()).toContain('Added Tiger Den to "Inbox"');
    const link = await pool.query<{ inbox_layer_id: string }>(
      "SELECT inbox_layer_id FROM messaging_link WHERE user_id=$1 AND channel='line'",
      [alice.id],
    );
    const inbox = link.rows[0].inbox_layer_id;
    const layer = await pool.query(
      "SELECT audience,owner_user_id FROM layer WHERE id=$1",
      [inbox],
    );
    expect(layer.rows[0]).toMatchObject({
      audience: "private",
      owner_user_id: alice.id,
    });
    expect(await layerPlaces(inbox)).toEqual([
      expect.objectContaining({ link_name: "Tiger Den" }),
    ]);
    // Same link again: a duplicate, not a second row.
    await handleEvent(
      message(
        "line",
        sender,
        "https://www.google.com/maps/place/Tiger+Den/@29.7052,-95.5523,17z",
      ),
      deps,
    );
    expect(lastReply()).toContain("already in");
    expect(await layerPlaces(inbox)).toHaveLength(1);
  });
  it("adds to the specific layer chosen on the web, from LINE and Instagram", async () => {
    const layer = (
      await createLayer(alice, {
        title: `Weekend eats ${run}`,
        city: "houston",
      })
    ).layer;
    await setDestination(alice, "line", { defaultLayerId: layer.id });
    await handleEvent(
      message(
        "line",
        `U-${run}-alice`,
        "https://maps.google.com/?q=Kim+Son+Restaurant",
      ),
      deps,
    );
    expect(lastReply()).toContain(`to "Weekend eats ${run}"`);
    await connect(alice, "instagram", `IG-${run}-alice`);
    await setDestination(alice, "instagram", { defaultLayerId: layer.id });
    replies = [];
    await handleEvent(
      message(
        "instagram",
        `IG-${run}-alice`,
        "https://www.google.com/maps/place/Blood+Bros+BBQ/@29.7,-95.4,17z",
      ),
      deps,
    );
    // Instagram replies go to the sender's scoped ID.
    expect(replies.at(-1)).toMatchObject({
      channel: "instagram",
      to: `IG-${run}-alice`,
    });
    expect(lastReply()).toContain("Added Blood Bros BBQ");
    const names = (await layerPlaces(layer.id)).map((p) => p.link_name);
    expect(names).toEqual(["Kim Son Restaurant", "Blood Bros BBQ"]);
    const recent = (await listConnections(alice)).recent;
    expect(recent[0]).toMatchObject({
      channel: "instagram",
      outcome: "added",
      added: 1,
    });
  });
  it("never targets public layers and falls back to the Inbox when rights are lost", async () => {
    const group = await createGroup(bob, {
      name: `Chat Circle ${run}`,
      city: "houston",
    });
    await pool.query(
      "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'editor')",
      [group.group.id, alice.id],
    );
    const groupLayer = (
      await createLayer(bob, {
        title: `Circle picks ${run}`,
        city: "houston",
        audience: "group",
        groupId: group.group.id,
      })
    ).layer;
    await setDestination(alice, "line", { defaultLayerId: groupLayer.id });
    await pool.query(
      "UPDATE group_member SET role='viewer' WHERE group_id=$1 AND user_id=$2",
      [group.group.id, alice.id],
    );
    await handleEvent(
      message("line", `U-${run}-alice`, "https://maps.google.com/?q=Pho+Binh"),
      deps,
    );
    expect(lastReply()).toContain("isn't available");
    expect(lastReply()).toContain('to "Inbox"');
    expect(await layerPlaces(groupLayer.id)).toHaveLength(0);
    const own = (
      await createLayer(alice, { title: `Public ${run}`, city: "houston" })
    ).layer;
    await pool.query("UPDATE layer SET audience='public' WHERE id=$1", [
      own.id,
    ]);
    await expect(
      setDestination(alice, "line", { defaultLayerId: own.id }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      setDestination(viewer, "line", { defaultLayerId: groupLayer.id }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("reports links it can't add without writing anything", async () => {
    const sender = `U-${run}-alice`;
    await handleEvent(message("line", sender, "no links here"), deps);
    expect(lastReply()).toContain("Send me a Google Maps link");
    await handleEvent(
      message(
        "line",
        sender,
        "https://www.google.com/maps/placelists/list/abc",
      ),
      deps,
    );
    expect(lastReply()).toContain("lists can't be added");
    await handleEvent(
      message("line", sender, "https://maps.google.com/?q=nowhere+at+all"),
      deps,
    );
    expect(lastReply()).toContain("couldn't find a place");
  });
  it("ignores redelivered events", async () => {
    const event = message(
      "line",
      `U-${run}-alice`,
      "https://maps.google.com/?q=Redelivered+Cafe",
    );
    await handleEvent(event, deps);
    await handleEvent(event, deps);
    expect(replies).toHaveLength(1);
  });
  it("disconnects on unfollow", async () => {
    await handleEvent(
      {
        kind: "unfollow",
        channel: "line",
        eventId: `${run}-unfollow`,
        senderId: `U-${run}-alice`,
      },
      deps,
    );
    const data = await listConnections(alice);
    expect(data.connections.find((c) => c.channel === "line")?.status).toBe(
      "none",
    );
  });
});
