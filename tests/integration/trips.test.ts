import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";
import { createCustomPlaceInLayer } from "../../apps/web/src/features/custom-places/service";
import {
  createLayer,
  removeLayerItem,
} from "../../apps/web/src/features/layers/service";
import {
  addLayerToCollection,
  createCollection,
} from "../../apps/web/src/features/layers/collections";
import { createGroup } from "../../apps/web/src/features/groups/service";
import {
  createTrip,
  deleteTrip,
  getTripView,
  listTrips,
  optimizeTrip,
  patchTripDay,
  patchTripStop,
  previewTrip,
  removeUnavailableStops,
  setTripBase,
} from "../../apps/web/src/features/trips/service";
import { flags } from "../../apps/web/src/lib/config";
import type { Actor } from "../../packages/shared/src";
/*
 * Trip scheduler (docs/plans/trip-scheduler-design.md): trips are planned from
 * a layer or folder, re-ordered per day on removal, private to their owner (or
 * group), and never show places the viewer cannot see.
 */
const alice: Actor = { id: crypto.randomUUID(), role: "USER" },
  bob: Actor = { id: crypto.randomUUID(), role: "USER" },
  editor: Actor = { id: crypto.randomUUID(), role: "USER" },
  viewer: Actor = { id: crypto.randomUUID(), role: "USER" };
const users = [alice, bob, editor, viewer];
let groupId: string;
let westLayer: string;
let eastLayer: string;
let groupLayer: string;
let folderId: string;
const itemOf = new Map<string, string>();

async function layerFor(actor: Actor, title: string, group?: string) {
  const created = await createLayer(actor, {
    title,
    city: "houston",
    ...(group ? { audience: "group", groupId: group } : {}),
  });
  return created.layer.id as string;
}
async function addPlace(
  actor: Actor,
  layerId: string,
  name: string,
  pin?: { latitude: number; longitude: number },
) {
  await createCustomPlaceInLayer(actor, layerId, {
    name,
    ...(pin ? { pin } : {}),
  });
  const row = await pool.query<{ id: string }>(
    `SELECT i.id FROM layer_item i JOIN custom_place cp ON cp.id=i.custom_place_id WHERE i.layer_id=$1 AND cp.name=$2`,
    [layerId, name],
  );
  itemOf.set(name, row.rows[0].id);
  return row.rows[0].id;
}
const labels = (stops: Array<{ label: string }>) => stops.map((s) => s.label);

beforeAll(async () => {
  for (const actor of users)
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [actor.id, "Trip Test", `${actor.id}@trips-test.example`, actor.role],
    );
  flags.layerWrites = true;
  flags.layerCustomPlaces = true;
  flags.trips = true;
  const group = await createGroup(alice, {
    name: "Trip Circle",
    city: "houston",
  });
  groupId = group.group.id;
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'editor'),($1,$3,'viewer')",
    [groupId, editor.id, viewer.id],
  );
  // Two neighborhoods about 20 km apart, in two private layers.
  westLayer = await layerFor(alice, "West side eats");
  eastLayer = await layerFor(alice, "East side eats");
  for (let i = 1; i <= 3; i++)
    await addPlace(alice, westLayer, `West ${i}`, {
      latitude: 29.72 + i * 0.003,
      longitude: -95.6,
    });
  for (let i = 1; i <= 3; i++)
    await addPlace(alice, eastLayer, `East ${i}`, {
      latitude: 29.72 + i * 0.003,
      longitude: -95.4,
    });
  await addPlace(alice, westLayer, "Pop-up (no pin)");
  groupLayer = await layerFor(alice, "Circle picks", groupId);
  await addPlace(alice, groupLayer, "Circle A", {
    latitude: 29.75,
    longitude: -95.36,
  });
  await addPlace(alice, groupLayer, "Circle B", {
    latitude: 29.76,
    longitude: -95.37,
  });
  const folder = await createCollection(alice, {
    title: "Weekend folder",
    city: "houston",
  });
  folderId = folder.id;
  await addLayerToCollection(alice, folderId, { layerId: westLayer });
  await addLayerToCollection(alice, folderId, { layerId: eastLayer });
});

afterAll(async () => {
  const ids = users.map((u) => u.id);
  await pool.query(
    "DELETE FROM trip WHERE owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  await pool.query(
    "DELETE FROM layer_collection WHERE owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  await pool.query(
    "DELETE FROM layer WHERE created_by=ANY($1::uuid[]) OR owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  await pool.query(
    "DELETE FROM custom_place WHERE owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query(
    "DELETE FROM analytics_event WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
});

describe("trips from a folder", () => {
  let tripId: string;
  it("plans the folder's places into one day per neighborhood", async () => {
    const trip = await createTrip(alice, {
      title: "Houston weekend",
      startsOn: "2026-11-07",
      endsOn: "2026-11-08",
      collectionId: folderId,
    });
    tripId = trip.trip.id;
    expect(trip.days.map((d) => d.date)).toEqual(["2026-11-07", "2026-11-08"]);
    const [d1, d2] = trip.days.map((d) => labels(d.stops).sort());
    const west = ["West 1", "West 2", "West 3"];
    const east = ["East 1", "East 2", "East 3"];
    expect([d1, d2]).toContainEqual(west);
    expect([d1, d2]).toContainEqual(east);
    // Visiting order along a line: the middle stop is never at an end.
    for (const day of trip.days) expect(labels(day.stops)[1]).toMatch(/ 2$/);
    expect(trip.notScheduled).toMatchObject([
      { label: "Pop-up (no pin)", reason: "no_location" },
    ]);
    for (const day of trip.days) {
      expect(day.stops[0].legMeters).toBeNull();
      expect(day.totalMeters).toBeGreaterThan(0);
    }
    expect(trip.canEdit).toBe(true);
    // Nothing about the places is stored on the trip.
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name IN ('trip','trip_stop','trip_day')",
    );
    expect(columns.rows.map((c) => c.column_name)).not.toEqual(
      expect.arrayContaining(["latitude"]),
    );
  });

  it("re-orders only that day when a stop is removed, and can undo", async () => {
    const before = await getTripView(tripId, alice);
    const day = before.days.find((d) => labels(d.stops).includes("West 2"))!;
    const other = before.days.find((d) => d.id !== day.id)!;
    const stop = day.stops.find((s) => s.label === "West 2")!;
    const after = await patchTripStop(alice, tripId, stop.id, {
      expectedRevision: before.revision,
      status: "removed",
    });
    const dayAfter = after.days.find((d) => d.id === day.id)!;
    expect(labels(dayAfter.stops).sort()).toEqual(["West 1", "West 3"]);
    expect(dayAfter.stops.map((s, i) => [s.id, i])).toHaveLength(2);
    expect(after.days.find((d) => d.id === other.id)!.stops).toEqual(
      other.stops,
    );
    expect(labels(after.removed)).toEqual(["West 2"]);
    expect(dayAfter.totalMeters).toBeLessThan(day.totalMeters + 1);
    const restored = await patchTripStop(alice, tripId, stop.id, {
      expectedRevision: after.revision,
      status: "active",
    });
    expect(
      labels(restored.days.find((d) => d.id === day.id)!.stops).sort(),
    ).toEqual(["West 1", "West 2", "West 3"]);
    expect(restored.removed).toEqual([]);
  });

  it("rejects stale revisions with 409", async () => {
    const view = await getTripView(tripId, alice);
    await expect(
      optimizeTrip(alice, tripId, {
        expectedRevision: view.revision - 1,
        scope: "all",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("moves a stop to another day and keeps it there on re-plan", async () => {
    const view = await getTripView(tripId, alice);
    const eastDay = view.days.find((d) => labels(d.stops).includes("East 1"))!;
    const westDay = view.days.find((d) => d.id !== eastDay.id)!;
    const east1 = eastDay.stops.find((s) => s.label === "East 1")!;
    const moved = await patchTripStop(alice, tripId, east1.id, {
      expectedRevision: view.revision,
      dayId: westDay.id,
    });
    expect(
      labels(moved.days.find((d) => d.id === westDay.id)!.stops),
    ).toContain("East 1");
    const replanned = await optimizeTrip(alice, tripId, {
      expectedRevision: moved.revision,
      scope: "all",
    });
    const pinned = replanned.days.find((d) => d.id === westDay.id)!.stops;
    expect(labels(pinned)).toContain("East 1");
    expect(pinned.find((s) => s.label === "East 1")!.pinned).toBe(true);
  });

  it("keeps a hand-set order on a manual day", async () => {
    const view = await getTripView(tripId, alice);
    const day = view.days[0];
    const order = day.stops.map((s) => s.id).reverse();
    const manual = await patchTripDay(alice, tripId, day.id, {
      expectedRevision: view.revision,
      order,
    });
    expect(manual.days[0].orderMode).toBe("manual");
    expect(manual.days[0].stops.map((s) => s.id)).toEqual(order);
    const replanned = await optimizeTrip(alice, tripId, {
      expectedRevision: manual.revision,
      scope: "all",
    });
    expect(replanned.days[0].stops.map((s) => s.id)).toEqual(order);
    const auto = await optimizeTrip(alice, tripId, {
      expectedRevision: replanned.revision,
      scope: "day",
      dayId: day.id,
    });
    expect(auto.days[0].orderMode).toBe("auto");
  });

  it("drops a deleted source item out of the route", async () => {
    const before = await getTripView(tripId, alice);
    const all = before.days.flatMap((d) => d.stops);
    const target = all.find((s) => s.label === "West 3")!;
    await removeLayerItem(alice, westLayer, target.key);
    const view = await getTripView(tripId, alice);
    expect(labels(view.days.flatMap((d) => d.stops))).not.toContain("West 3");
    expect(view.unavailableCount).toBe(1);
    const cleaned = await removeUnavailableStops(alice, tripId, {
      expectedRevision: view.revision,
    });
    expect(cleaned.unavailableCount).toBe(0);
  });

  it("is invisible to other users and lists for its owner", async () => {
    await expect(getTripView(tripId, bob)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      patchTripStop(bob, tripId, crypto.randomUUID(), {
        expectedRevision: 1,
        status: "removed",
      }),
    ).rejects.toMatchObject({ status: 404 });
    const mine = await listTrips(alice);
    expect(mine.trips.map((t) => t.id)).toContain(tripId);
    expect((await listTrips(bob)).trips).toEqual([]);
  });
});

describe("trips from a layer and group trips", () => {
  it("plans a single layer", async () => {
    const trip = await createTrip(alice, {
      title: "East only",
      startsOn: "2026-11-10",
      endsOn: "2026-11-10",
      layerId: eastLayer,
    });
    expect(labels(trip.days[0].stops).sort()).toEqual([
      "East 1",
      "East 2",
      "East 3",
    ]);
  });

  it("refuses another user's private layer", async () => {
    await expect(
      createTrip(bob, {
        title: "Not mine",
        startsOn: "2026-11-10",
        endsOn: "2026-11-10",
        layerId: eastLayer,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("keeps private-layer places out of a group trip", async () => {
    const preview = await previewTrip(alice, {
      groupId,
      layerItemIds: [itemOf.get("West 1")!, itemOf.get("Circle A")!],
    });
    expect(preview.included.map((p) => p.label)).toEqual(["Circle A"]);
    expect(preview.refused).toEqual([
      { itemId: itemOf.get("West 1"), reason: "audience_mismatch" },
    ]);
  });

  it("lets group editors edit, viewers only view, and outsiders nothing", async () => {
    const trip = await createTrip(editor, {
      title: "Circle day",
      startsOn: "2026-11-12",
      endsOn: "2026-11-12",
      groupId,
      layerId: groupLayer,
    });
    expect(trip.trip.audience).toBe("group");
    const seen = await getTripView(trip.trip.id, viewer);
    expect(seen.canEdit).toBe(false);
    expect(labels(seen.days[0].stops).sort()).toEqual(["Circle A", "Circle B"]);
    await expect(
      optimizeTrip(viewer, trip.trip.id, {
        expectedRevision: seen.revision,
        scope: "all",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(getTripView(trip.trip.id, bob)).rejects.toMatchObject({
      status: 404,
    });
    await expect(deleteTrip(viewer, trip.trip.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      createTrip(viewer, {
        title: "Viewer trip",
        startsOn: "2026-11-12",
        endsOn: "2026-11-12",
        groupId,
        layerId: groupLayer,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await deleteTrip(editor, trip.trip.id);
    await expect(getTripView(trip.trip.id, editor)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("trip base and per-day start and end", () => {
  let tripId: string;
  let hotelSouth: string;
  let hotelNorth: string;
  const rev = async (id = tripId, actor = alice) =>
    (await getTripView(id, actor)).revision;

  beforeAll(async () => {
    hotelSouth = await addPlace(alice, westLayer, "Hotel South", {
      latitude: 29.7,
      longitude: -95.6,
    });
    hotelNorth = await addPlace(alice, westLayer, "Hotel North", {
      latitude: 29.8,
      longitude: -95.6,
    });
    // Three stops on a north-south line between the two hotels.
    for (let i = 1; i <= 3; i++)
      await addPlace(alice, westLayer, `Base ${i}`, {
        latitude: 29.72 + i * 0.003,
        longitude: -95.6,
      });
    const trip = await createTrip(alice, {
      title: "Base trip",
      startsOn: "2026-11-20",
      endsOn: "2026-11-20",
      layerItemIds: ["Base 1", "Base 2", "Base 3"].map((n) => itemOf.get(n)!),
    });
    tripId = trip.trip.id;
  });

  it("starts with no base, as existing trips do", async () => {
    const view = await getTripView(tripId, alice);
    expect(view.base).toBeNull();
    expect(view.baseUnavailable).toBe(false);
    const [day] = view.days;
    expect(day.start).toBeNull();
    expect(day.end).toBeNull();
    expect(day.startKind).toBe("base");
    expect(day.stops[0].legMeters).toBeNull();
    expect(day.endLegMeters).toBeNull();
    // The hotels are offered; places already in the trip are not.
    const offered = view.baseCandidates.map((c) => c.label);
    expect(offered).toEqual(
      expect.arrayContaining(["Hotel South", "Hotel North"]),
    );
    expect(offered).not.toContain("Base 1");
  });

  it("orders each day from and back to the base, and counts both legs", async () => {
    const view = await setTripBase(alice, tripId, {
      expectedRevision: await rev(),
      baseItemId: hotelSouth,
    });
    expect(view.base).toMatchObject({ label: "Hotel South", kind: "base" });
    const [day] = view.days;
    expect(day.start?.label).toBe("Hotel South");
    expect(day.end?.label).toBe("Hotel South");
    expect(labels(day.stops)).toEqual(["Base 1", "Base 2", "Base 3"]);
    expect(day.stops[0].legMeters).toBeGreaterThan(0);
    expect(day.endLegMeters).toBeGreaterThan(0);
    const legs = day.stops.reduce((n, s) => n + (s.legMeters ?? 0), 0);
    expect(day.totalMeters).toBe(legs + day.endLegMeters!);

    const north = await setTripBase(alice, tripId, {
      expectedRevision: view.revision,
      baseItemId: hotelNorth,
    });
    expect(labels(north.days[0].stops)).toEqual(["Base 3", "Base 2", "Base 1"]);
  });

  it("lets a day override its start and end, then fall back", async () => {
    const view = await getTripView(tripId, alice);
    const dayId = view.days[0].id;
    const open = await patchTripDay(alice, tripId, dayId, {
      expectedRevision: view.revision,
      startKind: "first_stop",
      endKind: "item",
      endItemId: hotelSouth,
    });
    const [day] = open.days;
    expect(day.start).toBeNull();
    expect(day.end).toMatchObject({ label: "Hotel South", kind: "item" });
    expect(day.stops[day.stops.length - 1].label).toBe("Base 1");
    await expect(
      patchTripDay(alice, tripId, dayId, {
        expectedRevision: open.revision,
        startKind: "item",
      }),
    ).rejects.toThrow();
    const back = await patchTripDay(alice, tripId, dayId, {
      expectedRevision: open.revision,
      startKind: "base",
      endKind: "base",
    });
    expect(back.days[0].start?.label).toBe("Hotel North");
    expect(back.days[0].end?.label).toBe("Hotel North");
  });

  it("rejects stale revisions and unusable places", async () => {
    const current = await rev();
    await expect(
      setTripBase(alice, tripId, {
        expectedRevision: current - 1,
        baseItemId: hotelSouth,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      setTripBase(alice, tripId, {
        expectedRevision: current,
        baseItemId: itemOf.get("Pop-up (no pin)")!,
      }),
    ).rejects.toMatchObject({ status: 400, code: "NO_LOCATION" });
    // Not the owner: the trip itself looks missing.
    await expect(
      setTripBase(bob, tripId, {
        expectedRevision: current,
        baseItemId: hotelSouth,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await rev()).toBe(current);
  });

  it("clears the base and returns to an open path", async () => {
    const cleared = await setTripBase(alice, tripId, {
      expectedRevision: await rev(),
      baseItemId: null,
    });
    expect(cleared.base).toBeNull();
    const [day] = cleared.days;
    expect(day.start).toBeNull();
    expect(day.end).toBeNull();
    expect(day.endLegMeters).toBeNull();
    expect(day.stops[0].legMeters).toBeNull();
    const legs = day.stops.reduce((n, s) => n + (s.legMeters ?? 0), 0);
    expect(day.totalMeters).toBe(legs);
    const stored = await pool.query(
      "SELECT base_item_id FROM trip WHERE id=$1",
      [tripId],
    );
    expect(stored.rows[0].base_item_id).toBeNull();
  });

  describe("group trips", () => {
    let groupTrip: string;
    let circleHotel: string;
    beforeAll(async () => {
      circleHotel = await addPlace(alice, groupLayer, "Circle Hotel", {
        latitude: 29.74,
        longitude: -95.38,
      });
      const trip = await createTrip(editor, {
        title: "Circle base trip",
        startsOn: "2026-11-21",
        endsOn: "2026-11-21",
        groupId,
        layerItemIds: [itemOf.get("Circle A")!, itemOf.get("Circle B")!],
      });
      groupTrip = trip.trip.id;
    });

    it("lets editors set it and viewers see it but not change it", async () => {
      const set = await setTripBase(editor, groupTrip, {
        expectedRevision: await rev(groupTrip, editor),
        baseItemId: circleHotel,
      });
      expect(set.base?.label).toBe("Circle Hotel");
      const seen = await getTripView(groupTrip, viewer);
      expect(seen.canEdit).toBe(false);
      expect(seen.base?.label).toBe("Circle Hotel");
      expect(seen.baseCandidates).toEqual([]);
      await expect(
        setTripBase(viewer, groupTrip, {
          expectedRevision: seen.revision,
          baseItemId: null,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        patchTripDay(viewer, groupTrip, seen.days[0].id, {
          expectedRevision: seen.revision,
          startKind: "first_stop",
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(getTripView(groupTrip, bob)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        setTripBase(bob, groupTrip, {
          expectedRevision: seen.revision,
          baseItemId: null,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("refuses a base from a layer the group cannot use", async () => {
      // Invisible to the editor: looks missing.
      await expect(
        setTripBase(editor, groupTrip, {
          expectedRevision: await rev(groupTrip, editor),
          baseItemId: hotelSouth,
        }),
      ).rejects.toMatchObject({ status: 404 });
      // Alice can see her private layer, but a group trip may not use it.
      await expect(
        setTripBase(alice, groupTrip, {
          expectedRevision: await rev(groupTrip, alice),
          baseItemId: hotelSouth,
        }),
      ).rejects.toMatchObject({ status: 400, code: "AUDIENCE_MISMATCH" });
    });

    it("falls back to an open path when the base place is deleted, telling only editors", async () => {
      await pool.query("DELETE FROM layer_item WHERE id=$1", [circleHotel]);
      const asViewer = await getTripView(groupTrip, viewer);
      const asEditor = await getTripView(groupTrip, editor);
      expect(asViewer.base).toBeNull();
      expect(asViewer.days[0].start).toBeNull();
      expect(asEditor.base).toBeNull();
      // The deleted item cleared the reference, so there is nothing to warn about.
      expect(asEditor.baseUnavailable).toBe(false);
    });
  });
});
