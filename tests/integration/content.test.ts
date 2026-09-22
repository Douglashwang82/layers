import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import {
  createContent,
  saveContent,
} from "../../apps/web/src/features/content/service";
import { getContentPost } from "../../apps/web/src/features/content/repository";
import { moderate } from "../../apps/web/src/features/community/service";
import {
  createLayer,
  addLayerItem,
  updateLayer,
} from "../../apps/web/src/features/layers/service";
import { getLayerContents } from "../../apps/web/src/features/layers/contents";
import { getLayer } from "../../apps/web/src/features/layers/repository";
import { runMapQuery } from "../../apps/web/src/features/map/query";
import { getMapItemDetail } from "../../apps/web/src/features/map/detail";
import type { Actor } from "../../packages/shared/src";
const author: Actor = { id: crypto.randomUUID(), role: "USER" },
  admin: Actor = { id: crypto.randomUUID(), role: "ADMIN" };
const city = {
  id: "00000000-0000-4000-8000-000000001001",
  slug: "houston",
  name: "Houston",
  timezone: "America/Chicago",
  latitude: 29.7604,
  longitude: -95.3698,
};
const placeId = "00000000-0000-4000-8000-000000005000";
const eventId = "00000000-0000-4000-8000-000000006000";
const ids: string[] = [];
const state = (layers: string[]) => ({
  city: "houston",
  layers,
  date: "upcoming" as const,
  q: "",
  scope: "layers" as const,
  view: "map" as const,
  page: 1,
});
beforeAll(async () => {
  for (const actor of [author, admin])
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [actor.id, "Content Test", actor.id + "@example.test", actor.role],
    );
});
afterAll(async () => {
  await pool.query("DELETE FROM content_post WHERE id=ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM submission WHERE user_id=ANY($1::uuid[])", [
    [author.id, admin.id],
  ]);
  await pool.query(
    "DELETE FROM moderation_action WHERE actor_id=ANY($1::uuid[])",
    [[admin.id]],
  );
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    [author.id, admin.id],
  ]);
  await pool.end();
});
describe("local content with explicit location status", () => {
  it("validates, stays private until approved, then joins Discover", async () => {
    const post = await createContent(author, {
      title: "Where to find good soy milk",
      body: "A short guide to breakfast spots across the city.",
      locationStatus: "citywide",
      city: "houston",
    });
    ids.push(post.id);
    expect(post.status).toBe("pending");
    expect(post.latitude).toBeNull();
    await expect(getContentPost(post.slug, null)).rejects.toMatchObject({
      status: 404,
    });
    const before = await runMapQuery(state(["discover-houston"]), city, null);
    expect(before.items.some((i) => i.id === post.id)).toBe(false);
    await moderate(admin, {
      entityType: "content",
      entityId: post.id,
      action: "approved",
      reason: "Looks good",
    });
    const after = await runMapQuery(state(["discover-houston"]), city, null);
    const item = after.items.find((i) => i.id === post.id)!;
    expect(item.type).toBe("content");
    expect(item.locationStatus).toBe("citywide");
    expect(item.latitude).toBeNull();
    expect(after.unmapped).toBeGreaterThanOrEqual(1);
    expect(after.mapped + after.unmapped).toBe(after.total);
  });
  it("uses a linked place's public location and never fabricates a pin otherwise", async () => {
    const linked = await createContent(admin, {
      title: "Order the beef noodle soup",
      body: "Ask for extra pickled greens.",
      placeId,
      locationStatus: "unspecified",
      city: "houston",
    });
    ids.push(linked.id);
    expect(linked.status).toBe("approved");
    expect(linked.locationStatus).toBe("exact");
    expect(linked.latitude).not.toBeNull();
    const area = await createContent(admin, {
      title: "Bellaire tea crawl",
      body: "Three shops within a short walk.",
      locationStatus: "approximate",
      neighborhood: "Bellaire",
      city: "houston",
    });
    ids.push(area.id);
    expect(area.latitude).toBeNull();
    await expect(
      createContent(admin, {
        title: "Both",
        body: "x",
        placeId,
        eventId,
        city: "houston",
      }),
    ).rejects.toBeTruthy();
    await expect(
      createContent(admin, {
        title: "Exact without a point",
        body: "x",
        locationStatus: "exact",
        city: "houston",
      }),
    ).rejects.toBeTruthy();
    const result = await runMapQuery(state(["discover-houston"]), city, null);
    expect(result.items.find((i) => i.id === linked.id)?.latitude).toBe(
      result.items.find((i) => i.id === placeId)?.latitude,
    );
    expect(result.items.find((i) => i.id === area.id)?.latitude).toBeNull();
  });
  it("coexists with a restaurant and event in a personal layer and respects validity windows", async () => {
    const layer = await createLayer(author, {
      title: "Mixed weekend",
      city: "houston",
    });
    const timed = await createContent(admin, {
      title: "Pop-up this week only",
      body: "Ends soon.",
      locationStatus: "online",
      validFrom: new Date(Date.now() - 86400000).toISOString(),
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      city: "houston",
    });
    const expired = await createContent(admin, {
      title: "Last month's pop-up",
      body: "Over.",
      locationStatus: "online",
      validFrom: new Date(Date.now() - 40 * 86400000).toISOString(),
      validUntil: new Date(Date.now() - 30 * 86400000).toISOString(),
      city: "houston",
    });
    ids.push(timed.id, expired.id);
    for (const key of [
      `place:${placeId}`,
      `event:${eventId}`,
      `content:${timed.id}`,
      `content:${expired.id}`,
    ])
      expect((await addLayerItem(author, layer.layer.id, { key })).added).toBe(
        true,
      );
    await updateLayer(author, layer.layer.id, {
      revision: layer.layer.revision,
      lifecycle: "active",
    });
    const contents = await getLayerContents(
      (await getLayer(layer.layer.id, author))!.layer,
      city,
      author,
    );
    const types = new Set(contents.items.map((i) => i.type));
    expect(types.has("place")).toBe(true);
    expect(types.has("content")).toBe(true);
    expect(contents.items.some((i) => i.id === timed.id)).toBe(true);
    expect(contents.items.some((i) => i.id === expired.id)).toBe(false);
    const detail = await getMapItemDetail(`content:${timed.id}`, author);
    expect(detail.type).toBe("content");
    expect(
      detail.editableLayers.find((l) => l.id === layer.layer.id)?.contains,
    ).toBe(true);
    expect((await saveContent(author, timed.id, true)).saved).toBe(true);
    expect((await getContentPost(timed.id, author)).saved).toBe(true);
    await pool.query("DELETE FROM layer WHERE id=$1", [layer.layer.id]);
  });
  it("removes hidden content from every layer and result", async () => {
    const post = await createContent(admin, {
      title: "Soon hidden",
      body: "x",
      locationStatus: "citywide",
      city: "houston",
    });
    ids.push(post.id);
    await moderate(admin, {
      entityType: "content",
      entityId: post.id,
      action: "hidden",
      reason: "Test",
    });
    const result = await runMapQuery(state(["discover-houston"]), city, null);
    expect(result.items.some((i) => i.id === post.id)).toBe(false);
    await expect(getContentPost(post.id, author)).rejects.toMatchObject({
      status: 404,
    });
  });
});
