import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import {
  createGroup,
  inviteMember,
  acceptInvite,
  setMemberRole,
  removeMember,
  revokeInvite,
} from "../../apps/web/src/features/groups/service";
import {
  createLayer,
  updateLayer,
  addLayerItem,
  publishLayer,
  followLayer,
  removeLayerItem,
} from "../../apps/web/src/features/layers/service";
import {
  getLayer,
  listLibrary,
} from "../../apps/web/src/features/layers/repository";
import { getInviteByToken } from "../../apps/web/src/features/groups/repository";
import { runMapQuery } from "../../apps/web/src/features/map/query";
import type { Actor } from "../../packages/shared/src";
const owner: Actor = { id: crypto.randomUUID(), role: "USER" },
  editor: Actor = { id: crypto.randomUUID(), role: "USER" },
  viewer: Actor = { id: crypto.randomUUID(), role: "USER" },
  stranger: Actor = { id: crypto.randomUUID(), role: "USER" };
const emails: Record<string, string> = {};
const city = {
  id: "00000000-0000-4000-8000-000000001001",
  slug: "houston",
  name: "Houston",
  timezone: "America/Chicago",
  latitude: 29.7604,
  longitude: -95.3698,
};
const placeKey = "place:00000000-0000-4000-8000-000000005000";
let groupId: string;
let layerId: string;
let layerSlug: string;
beforeAll(async () => {
  for (const actor of [owner, editor, viewer, stranger]) {
    emails[actor.id] = `${actor.id}@example.test`;
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [actor.id, "Group Test", emails[actor.id], actor.role],
    );
  }
});
afterAll(async () => {
  await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [
    [owner.id, editor.id, viewer.id, stranger.id],
  ]);
  await pool.end();
});
describe("group membership, roles and restricted layers", () => {
  it("creates a group with its creator as owner and invites by email", async () => {
    const created = await createGroup(owner, {
      name: "Bayou Taiwanese Students",
      city: "houston",
    });
    groupId = created.group.id;
    expect(created.role).toBe("owner");
    const editorInvite = await inviteMember(owner, groupId, {
      email: emails[editor.id],
      role: "editor",
    });
    const viewerInvite = await inviteMember(owner, groupId, {
      email: emails[viewer.id],
      role: "viewer",
    });
    // Only the intended signed-in account can accept; nobody else.
    await expect(
      acceptInvite(stranger, editorInvite.token),
    ).rejects.toMatchObject({ status: 403 });
    await expect(acceptInvite(null, editorInvite.token)).rejects.toMatchObject({
      status: 401,
    });
    expect((await acceptInvite(editor, editorInvite.token)).role).toBe(
      "editor",
    );
    expect((await acceptInvite(viewer, viewerInvite.token)).role).toBe(
      "viewer",
    );
    // An accepted invitation cannot be reused; a revoked one cannot be accepted.
    await expect(
      acceptInvite(editor, editorInvite.token),
    ).rejects.toMatchObject({ status: 404 });
    const revoked = await inviteMember(owner, groupId, {
      email: emails[stranger.id],
    });
    await revokeInvite(owner, groupId, revoked.id);
    expect((await getInviteByToken(revoked.token))?.valid).toBe(false);
    await expect(acceptInvite(stranger, revoked.token)).rejects.toMatchObject({
      status: 404,
    });
    // Editors cannot invite or change roles.
    await expect(
      inviteMember(editor, groupId, { email: "x@example.test" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      setMemberRole(editor, groupId, viewer.id, { role: "editor" }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("enforces the permission table on group layers", async () => {
    const created = await createLayer(editor, {
      title: "Student favorites",
      city: "houston",
      audience: "group",
      groupId,
    });
    layerId = created.layer.id;
    layerSlug = created.layer.slug;
    expect(created.layer.audience).toBe("group");
    expect(created.access.edit).toBe(true);
    expect(created.access.manage).toBe(false);
    // Viewers read and apply; they cannot edit contents.
    const asViewer = await getLayer(layerId, viewer);
    expect(asViewer?.access).toMatchObject({
      view: true,
      apply: true,
      edit: false,
      manage: false,
    });
    await expect(
      addLayerItem(viewer, layerId, { key: placeKey }),
    ).rejects.toMatchObject({ status: 403 });
    // Editors edit contents but cannot change audience.
    expect((await addLayerItem(editor, layerId, { key: placeKey })).added).toBe(
      true,
    );
    expect((await addLayerItem(editor, layerId, { key: placeKey })).added).toBe(
      false,
    );
    await expect(publishLayer(editor, layerId, true)).rejects.toMatchObject({
      status: 403,
    });
    // Owners inherit management from the group but group layers stay with members.
    await expect(publishLayer(owner, layerId, true)).rejects.toMatchObject({
      status: 400,
    });
    // A follow relationship never grants access.
    await expect(followLayer(stranger, layerId, true)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("reveals no restricted titles, counts or items to non-members", async () => {
    expect(await getLayer(layerId, stranger)).toBeNull();
    expect(await getLayer(layerId, null)).toBeNull();
    expect(await listLibrary("groups", stranger, city)).toEqual([]);
    const result = await runMapQuery(
      {
        city: "houston",
        layers: [layerSlug],
        date: "upcoming",
        q: "",
        scope: "layers",
        view: "map",
        page: 1,
      },
      city,
      stranger,
    );
    expect(result.layers[0]).toMatchObject({
      status: "unavailable",
      title: "",
      count: 0,
    });
    expect(result.total).toBe(0);
    const member = await runMapQuery(
      {
        city: "houston",
        layers: [layerSlug],
        date: "upcoming",
        q: "",
        scope: "layers",
        view: "map",
        page: 1,
      },
      city,
      viewer,
    );
    expect(member.layers[0].status).toBe("ok");
    expect(member.items.map((i) => i.key)).toContain(placeKey);
    const library = await listLibrary("groups", viewer, city);
    expect(library.map((l) => l.layer.id)).toContain(layerId);
  });
  it("recovers from conflicting edits with a version check and audits the editor", async () => {
    const current = (await getLayer(layerId, editor))!.layer;
    const updated = await updateLayer(editor, layerId, {
      revision: current.revision,
      description: "Curated by students.",
    });
    expect(updated.layer.revision).toBe(current.revision + 1);
    expect(updated.layer.updatedByName).toBe("Group Test");
    await expect(
      updateLayer(owner, layerId, {
        revision: current.revision,
        title: "Stale title",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getLayer(layerId, owner))!.layer.title).toBe(
      "Student favorites",
    );
  });
  it("keeps a last owner and removes access on revocation", async () => {
    await expect(
      setMemberRole(owner, groupId, owner.id, { role: "editor" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(removeMember(owner, groupId, owner.id)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      removeMember(viewer, groupId, editor.id),
    ).rejects.toMatchObject({ status: 403 });
    expect((await removeMember(owner, groupId, viewer.id)).removed).toBe(true);
    expect(await getLayer(layerId, viewer)).toBeNull();
    await expect(
      removeLayerItem(viewer, layerId, placeKey),
    ).rejects.toMatchObject({ status: 404 });
    // Promoting a second owner lets the first step down.
    await setMemberRole(owner, groupId, editor.id, { role: "owner" });
    expect(
      (await setMemberRole(editor, groupId, owner.id, { role: "viewer" })).role,
    ).toBe("viewer");
    expect((await getLayer(layerId, owner))!.access.edit).toBe(false);
  });
});
