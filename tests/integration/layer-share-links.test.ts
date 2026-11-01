import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";
import {
  createLayer,
  updateLayer,
} from "../../apps/web/src/features/layers/service";
import { createGroup } from "../../apps/web/src/features/groups/service";
import { createCustomPlaceInLayer } from "../../apps/web/src/features/custom-places/service";
import {
  createShareLink,
  getShareLinkStatus,
  loadSharedLayer,
  revokeShareLink,
} from "../../apps/web/src/features/layers/share-links";
import { flags } from "../../apps/web/src/lib/config";
import type { Actor } from "../../packages/shared/src";

/* Read-only link-view sharing: token lifecycle, dead states and payload safety. */
const owner: Actor = { id: crypto.randomUUID(), role: "USER" },
  other: Actor = { id: crypto.randomUUID(), role: "USER" };
const users = [owner, other];
const tokenOf = (url: string) => url.split("/shared/")[1];
let layerId: string;
let groupId: string | null = null;
beforeAll(async () => {
  flags.layerWrites = true;
  flags.layerCustomPlaces = true;
  for (const actor of users)
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [
        actor.id,
        "Share Link Test",
        `${actor.id}@share-links.example`,
        actor.role,
      ],
    );
  layerId = (
    await createLayer(owner, { title: "Weekend picks", city: "houston" })
  ).layer.id;
  await createCustomPlaceInLayer(owner, layerId, {
    name: "Secret backyard",
    address: "123 Private Lane",
    pin: { latitude: 29.705, longitude: -95.55 },
    website: "https://example.test/private",
    note: "gate code 1234",
  });
  await pool.query(
    "UPDATE layer_item SET note='member only note' WHERE layer_id=$1",
    [layerId],
  );
});
afterAll(async () => {
  const ids = users.map((u) => u.id);
  await pool.query(
    "DELETE FROM layer WHERE owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  await pool.query(
    "DELETE FROM custom_place WHERE owner_user_id=ANY($1::uuid[])",
    [ids],
  );
  if (groupId) await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query(
    "DELETE FROM analytics_event WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
});
describe("view-only layer share links", () => {
  it("rejects a non-manager and a signed-out caller", async () => {
    await expect(createShareLink(other, layerId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(createShareLink(null, layerId)).rejects.toMatchObject({
      status: 401,
    });
    await expect(getShareLinkStatus(other, layerId)).rejects.toMatchObject({
      status: 404,
    });
    expect(await getShareLinkStatus(owner, layerId)).toEqual({
      active: false,
      createdAt: null,
    });
  });
  it("lets anyone with the link view the layer signed out, without private fields", async () => {
    const created = await createShareLink(owner, layerId);
    const token = tokenOf(created.url);
    expect(await getShareLinkStatus(owner, layerId)).toMatchObject({
      active: true,
    });
    const stored = await pool.query(
      "SELECT token_hash FROM layer_share_link WHERE layer_id=$1",
      [layerId],
    );
    expect(stored.rows[0].token_hash).not.toBe(token);
    const view = await loadSharedLayer(token);
    expect(view?.title).toBe("Weekend picks");
    expect(view?.places.map((p) => p.name)).toEqual(["Secret backyard"]);
    // A member-dropped pin shows its name only.
    expect(view?.places[0].address).toBe("");
    const json = JSON.stringify(view);
    for (const leaked of [
      "gate code",
      "member only note",
      "example.test/private",
      "29.705",
      "123 Private Lane",
      "updatedByName",
      "review",
      owner.id,
    ])
      expect(json).not.toContain(leaked);
  });
  it("kills the old token when the link is reset", async () => {
    const first = tokenOf((await createShareLink(owner, layerId)).url);
    const second = tokenOf((await createShareLink(owner, layerId)).url);
    expect(await loadSharedLayer(first)).toBeNull();
    expect(await loadSharedLayer(second)).not.toBeNull();
    const active = await pool.query(
      "SELECT count(*)::int AS n FROM layer_share_link WHERE layer_id=$1 AND revoked_at IS NULL",
      [layerId],
    );
    expect(active.rows[0].n).toBe(1);
  });
  it("serializes concurrent creates without a 500", async () => {
    const results = await Promise.allSettled([
      createShareLink(owner, layerId),
      createShareLink(owner, layerId),
    ]);
    for (const r of results)
      if (r.status === "rejected")
        expect(r.reason).toMatchObject({ code: "SHARE_LINK_CONFLICT" });
    const active = await pool.query(
      "SELECT count(*)::int AS n FROM layer_share_link WHERE layer_id=$1 AND revoked_at IS NULL",
      [layerId],
    );
    expect(active.rows[0].n).toBe(1);
  });
  it("stops working when revoked, and rejects malformed tokens", async () => {
    const token = tokenOf((await createShareLink(owner, layerId)).url);
    await expect(revokeShareLink(other, layerId)).rejects.toMatchObject({
      status: 404,
    });
    expect(await revokeShareLink(owner, layerId)).toEqual({ revoked: true });
    expect(await loadSharedLayer(token)).toBeNull();
    expect(await revokeShareLink(owner, layerId)).toEqual({ revoked: false });
    expect(await loadSharedLayer("bad")).toBeNull();
    expect(await loadSharedLayer("a".repeat(80))).toBeNull();
  });
  it("is dead while the layer is archived and revives when restored", async () => {
    const token = tokenOf((await createShareLink(owner, layerId)).url);
    const current = await pool.query<{ revision: number }>(
      "SELECT revision FROM layer WHERE id=$1",
      [layerId],
    );
    await updateLayer(owner, layerId, {
      revision: current.rows[0].revision,
      lifecycle: "archived",
    });
    expect(await loadSharedLayer(token)).toBeNull();
    await pool.query("UPDATE layer SET lifecycle='active' WHERE id=$1", [
      layerId,
    ]);
    expect(await loadSharedLayer(token)).not.toBeNull();
  });
  it("is dead when the layer is hidden or the creator loses manage access", async () => {
    const token = tokenOf((await createShareLink(owner, layerId)).url);
    await pool.query("UPDATE layer SET review_status='hidden' WHERE id=$1", [
      layerId,
    ]);
    expect(await loadSharedLayer(token)).toBeNull();
    await pool.query(
      "UPDATE layer SET review_status='unsubmitted' WHERE id=$1",
      [layerId],
    );
    expect(await loadSharedLayer(token)).not.toBeNull();
    // Group layer: demoting the creating owner kills the link.
    const group = await createGroup(owner, {
      name: "Share Circle",
      city: "houston",
    });
    groupId = group.group.id;
    const groupLayer = (
      await createLayer(owner, {
        title: "Circle picks",
        city: "houston",
        audience: "group",
        groupId,
      })
    ).layer.id;
    const groupToken = tokenOf((await createShareLink(owner, groupLayer)).url);
    expect(await loadSharedLayer(groupToken)).not.toBeNull();
    await pool.query(
      "UPDATE group_member SET role='viewer' WHERE group_id=$1 AND user_id=$2",
      [groupId, owner.id],
    );
    expect(await loadSharedLayer(groupToken)).toBeNull();
  });
});
