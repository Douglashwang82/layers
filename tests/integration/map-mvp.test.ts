import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";
import {
  createLayerFromGoogle,
  importGooglePlaces,
  linkBudget,
  resolveGoogleLinks,
} from "../../apps/web/src/features/google-links/service";
import {
  createLayerEvent,
  deleteLayerEvent,
  listLayerEvents,
  updateLayerEvent,
} from "../../apps/web/src/features/layers/events";
import {
  createLayer,
  publishLayer,
} from "../../apps/web/src/features/layers/service";
import {
  listLibrary,
  listMapLibrary,
} from "../../apps/web/src/features/layers/repository";
import { createGroup } from "../../apps/web/src/features/groups/service";
import { listExternalReferences } from "../../apps/web/src/features/map/external";
import { placeLocations } from "../../apps/web/src/features/google-links/locations";
import {
  fakeResolverFetch,
  fetchPlaceLocation,
} from "../../apps/web/src/features/google-links/resolver";
import { runMapQuery } from "../../apps/web/src/features/map/query";
import { mvpMapState } from "../../apps/web/src/features/map/request";
import { flags } from "../../apps/web/src/lib/config";
import {
  parseMapQuery,
  type Actor,
  type MapState,
} from "../../packages/shared/src";
/*
 * Map MVP (docs/plans/layer-mvp-google-links-plan.md): layers built from
 * Google place IDs, system layers disabled, search ignored, and events
 * attached to places in a layer.
 */
const alice: Actor = { id: crypto.randomUUID(), role: "USER" },
  bob: Actor = { id: crypto.randomUUID(), role: "USER" },
  editor: Actor = { id: crypto.randomUUID(), role: "USER" },
  viewer: Actor = { id: crypto.randomUUID(), role: "USER" },
  moderator: Actor = { id: crypto.randomUUID(), role: "MODERATOR" };
const users = [alice, bob, editor, viewer, moderator];
const city = {
  id: "00000000-0000-4000-8000-000000001001",
  slug: "houston",
  name: "Houston",
  timezone: "America/Chicago",
  latitude: 29.7604,
  longitude: -95.3698,
};
const run = crypto.randomUUID().slice(0, 8);
const placeId = (n: number) => `mvp-${run}-${n}`;
let groupId: string;
const state = (layers: string[], extra: Partial<MapState> = {}): MapState => ({
  city: "houston",
  layers,
  date: "upcoming",
  q: "",
  scope: "layers",
  view: "map",
  page: 1,
  ...extra,
});
async function subjectOf(providerPlaceId: string) {
  const { rows } = await pool.query<{ subject_id: string }>(
    "SELECT subject_id FROM place_provider_reference WHERE provider_place_id=$1",
    [providerPlaceId],
  );
  return rows[0].subject_id;
}
const flagsBefore = { ...flags };
beforeAll(async () => {
  for (const actor of users)
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [actor.id, "Map MVP", `${actor.id}@map-mvp.example`, actor.role],
    );
  Object.assign(flags, { mapMvp: true, layerWrites: true });
  process.env.GOOGLE_MAPS_LINK_API_KEY = "fake";
  const group = await createGroup(alice, {
    name: "MVP Circle",
    city: "houston",
  });
  groupId = group.group.id;
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'editor'),($1,$3,'viewer')",
    [groupId, editor.id, viewer.id],
  );
});
afterAll(async () => {
  Object.assign(flags, flagsBefore);
  delete process.env.GOOGLE_MAPS_LINK_API_KEY;
  const ids = users.map((u) => u.id);
  await pool.query(
    "DELETE FROM layer WHERE created_by=ANY($1::uuid[]) OR owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  const subjects = await pool.query<{ subject_id: string }>(
    "SELECT subject_id FROM place_provider_reference WHERE provider_place_id LIKE ANY($1::text[])",
    [[`mvp-${run}-%`, `fake-link-${run}%`]],
  );
  const subjectIds = subjects.rows.map((r) => r.subject_id);
  await pool.query(
    "DELETE FROM place_provider_reference WHERE subject_id=ANY($1::uuid[])",
    [subjectIds],
  );
  await pool.query("DELETE FROM place_subject WHERE id=ANY($1::uuid[])", [
    subjectIds,
  ]);
  await pool.query("DELETE FROM submission WHERE user_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query(
    "DELETE FROM analytics_event WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query("DELETE FROM rate_limit WHERE key LIKE ANY($1::text[])", [
    ids.flatMap((id) => [`google-links:${id}`, `contribution:${id}`]),
  ]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
});
describe("layers from Google places", () => {
  it("creates an active private layer with its places in one step", async () => {
    const created = await createLayerFromGoogle(alice, {
      title: "Weekend eats",
      city: "houston",
      providerPlaceIds: [placeId(1), placeId(2), placeId(1)],
    });
    expect(created.layer).toMatchObject({
      audience: "private",
      lifecycle: "active",
      ownerUserId: alice.id,
    });
    expect(created.added).toBe(2);
    const refs = await listExternalReferences(
      state([created.layer.slug]),
      city,
      alice,
      0,
    );
    expect(refs.references.map((r) => r.providerPlaceId)).toEqual([
      placeId(1),
      placeId(2),
    ]);
    // Private: nobody else sees it.
    const bobs = await listExternalReferences(
      state([created.layer.slug]),
      city,
      bob,
      0,
    );
    expect(bobs.references).toEqual([]);
  });
  it("keeps each link's name on its layer item, refreshed by pasting again", async () => {
    const created = await createLayerFromGoogle(alice, {
      title: "Named eats",
      city: "houston",
      providerPlaceIds: [placeId(50), placeId(51)],
      linkNames: { [placeId(50)]: "Jibun Doki" },
    });
    const names = async (slug: string) =>
      (
        await listExternalReferences(state([slug]), city, alice, 0)
      ).references.map((r) => r.name);
    expect(await names(created.layer.slug)).toEqual(["Jibun Doki", null]);
    // Pasting both again fills the missing name and replaces the old one.
    const again = await importGooglePlaces(alice, created.layer.id, {
      providerPlaceIds: [placeId(50), placeId(51)],
      linkNames: {
        [placeId(50)]: "Jibun Doki Marunouchi",
        [placeId(51)]: "Cafe",
      },
    });
    expect(again.added).toBe(0);
    expect(await names(created.layer.slug)).toEqual([
      "Jibun Doki Marunouchi",
      "Cafe",
    ]);
    // The name belongs to that layer: another layer with the place has none.
    const other = (
      await createLayer(alice, { title: "Other", city: "houston" })
    ).layer;
    await importGooglePlaces(alice, other.id, {
      providerPlaceIds: [placeId(50)],
    });
    await pool.query("UPDATE layer SET lifecycle='active' WHERE id=$1", [
      other.id,
    ]);
    expect(await names(other.slug)).toEqual([null]);
  });
  it("adds places to an existing layer idempotently and only for its editors", async () => {
    const layer = (await createLayer(alice, { title: "List", city: "houston" }))
      .layer;
    await expect(
      importGooglePlaces(alice, layer.id, {
        providerPlaceIds: [placeId(3)],
      }),
    ).resolves.toEqual({ added: 1, skipped: [] });
    await expect(
      importGooglePlaces(alice, layer.id, {
        providerPlaceIds: [placeId(3), placeId(4)],
      }),
    ).resolves.toEqual({
      added: 1,
      skipped: [{ providerPlaceId: placeId(3), reason: "DUPLICATE" }],
    });
    await expect(
      importGooglePlaces(bob, layer.id, { providerPlaceIds: [placeId(5)] }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("creates group layers for group editors only", async () => {
    await expect(
      createLayerFromGoogle(editor, {
        title: "Circle picks",
        city: "houston",
        audience: "group",
        groupId,
        providerPlaceIds: [placeId(6)],
      }),
    ).resolves.toMatchObject({ layer: { audience: "group" }, added: 1 });
    await expect(
      createLayerFromGoogle(viewer, {
        title: "Viewer picks",
        city: "houston",
        audience: "group",
        groupId,
        providerPlaceIds: [placeId(7)],
      }),
    ).rejects.toMatchObject({ status: 403 });
    // Nothing was written for the rejected request.
    const { rowCount } = await pool.query(
      "SELECT 1 FROM layer WHERE title='Viewer picks'",
    );
    expect(rowCount).toBe(0);
  });
  it("skips places a public layer cannot take without review", async () => {
    const layer = (
      await createLayer(alice, { title: "Going public", city: "houston" })
    ).layer;
    await publishLayer(alice, layer.id, true);
    await expect(
      importGooglePlaces(alice, layer.id, { providerPlaceIds: [placeId(8)] }),
    ).resolves.toEqual({
      added: 0,
      skipped: [
        { providerPlaceId: placeId(8), reason: "CITY_REVIEW_REQUIRED" },
      ],
    });
  });
  it("resolves pasted links and caps the links checked per window", async () => {
    const { results } = await resolveGoogleLinks(bob, {
      links: [
        "https://maps.google.com/?q=Tiger+Den",
        "https://www.google.com/maps/placelists/list/abc",
      ],
    });
    expect(results).toMatchObject([
      {
        status: "resolved",
        providerPlaceId: expect.stringMatching(/^fake-link-/),
      },
      { status: "unsupported", reason: "list" },
    ]);
    const batch = { links: Array(50).fill("https://maps.google.com/?q=Cafe") };
    for (let used = 2; used + 50 <= linkBudget.links; used += 50)
      await resolveGoogleLinks(bob, batch);
    await expect(resolveGoogleLinks(bob, batch)).rejects.toMatchObject({
      status: 429,
    });
  });
  it("is unavailable while the MVP flag is off", async () => {
    flags.mapMvp = false;
    try {
      await expect(
        createLayerFromGoogle(alice, {
          title: "Off",
          city: "houston",
          providerPlaceIds: [placeId(9)],
        }),
      ).rejects.toMatchObject({ code: "DISABLED" });
    } finally {
      flags.mapMvp = true;
    }
  });
});
describe("the MVP map", () => {
  it("drops system layers silently and keeps the member's layers", async () => {
    const mine = (
      await createLayerFromGoogle(alice, {
        title: "Mine",
        city: "houston",
        providerPlaceIds: [placeId(10)],
      })
    ).layer.slug;
    const result = await runMapQuery(
      state(["discover-houston", "today-houston", mine]),
      city,
      alice,
    );
    expect(result.state.layers).toEqual([mine]);
    expect(result.layers.map((l) => [l.slug, l.status])).toEqual([
      [mine, "ok"],
    ]);
    const library = await listLibrary("discover", alice, city);
    expect(library.some((l) => l.layer.ownerKind === "system")).toBe(false);
    const picker = await listMapLibrary(alice, city);
    expect(picker.map((l) => l.layer.slug)).toContain(mine);
    expect(picker[0].layer.slug).toBe("my-saves");
  });
  it("shows a layer in every city and counts its Google places", async () => {
    // Made while Houston was selected, holding places that are elsewhere (M6).
    const trip = (
      await createLayerFromGoogle(alice, {
        title: "Tokyo trip",
        city: "houston",
        providerPlaceIds: [placeId(30), placeId(31)],
      })
    ).layer.slug;
    const { rows } = await pool.query(
      "SELECT id,slug,name,timezone,latitude,longitude FROM city WHERE slug='tokyo'",
    );
    const tokyo = rows[0];
    const result = await runMapQuery(
      state([trip], { city: "tokyo" }),
      tokyo,
      alice,
    );
    expect(result.layers).toMatchObject([
      { slug: trip, status: "ok", count: 2 },
    ]);
    const refs = await listExternalReferences(
      state([trip], { city: "tokyo" }),
      tokyo,
      alice,
      0,
    );
    expect(refs.references).toHaveLength(2);
    // With the flag off, layers stay scoped to their own city.
    flags.mapMvp = false;
    try {
      const scoped = await runMapQuery(
        state([trip], { city: "tokyo" }),
        tokyo,
        alice,
      );
      expect(scoped.layers).toMatchObject([
        { slug: trip, status: "other-city" },
      ]);
    } finally {
      flags.mapMvp = true;
    }
  });
  it("caches Google coordinates for pins for at most 30 days", async () => {
    // The fake server key locates `fake-link-` IDs and finds no other place.
    const located = `fake-link-${run}a`;
    const layer = (
      await createLayerFromGoogle(alice, {
        title: "Pinned",
        city: "houston",
        providerPlaceIds: [located, placeId(40)],
      })
    ).layer.slug;
    const expected = (await fetchPlaceLocation(located, {
      fetch: fakeResolverFetch,
      apiKey: "fake",
    }))!;
    expect(expected).toEqual({
      lat: expect.any(Number),
      lng: expect.any(Number),
      types: expect.arrayContaining(["restaurant"]),
    });
    const { types, ...pin } = expected;
    const list = () =>
      listExternalReferences(state([layer]), city, alice, 0).then((r) =>
        Object.fromEntries(
          r.references.map((ref) => [ref.providerPlaceId, ref.location]),
        ),
      );
    expect(await list()).toEqual({
      [located]: pin,
      [placeId(40)]: null,
    });
    const stored = await pool.query(
      "SELECT latitude,longitude,types,location_fetched_at FROM place_provider_reference WHERE provider_place_id=$1",
      [located],
    );
    expect(stored.rows[0]).toMatchObject({
      latitude: expected.lat,
      longitude: expected.lng,
      types,
    });
    expect(stored.rows[0].location_fetched_at).toBeInstanceOf(Date);
    // Past 30 days the value is cleared, even with lookups unavailable...
    await pool.query(
      "UPDATE place_provider_reference SET location_fetched_at=now()-interval '31 days' WHERE provider_place_id=$1",
      [located],
    );
    const subject = await subjectOf(located);
    expect((await placeLocations([subject], null)).size).toBe(0);
    const cleared = await pool.query(
      "SELECT latitude,types,location_fetched_at FROM place_provider_reference WHERE provider_place_id=$1",
      [located],
    );
    expect(cleared.rows[0]).toEqual({
      latitude: null,
      types: null,
      location_fetched_at: null,
    });
    // ...and looked up again the next time the place is listed.
    expect((await list())[located]).toEqual(pin);
    // A pin cached before types were fetched is looked up once more for them.
    await pool.query(
      "UPDATE place_provider_reference SET types=NULL WHERE provider_place_id=$1",
      [located],
    );
    await list();
    const refetched = await pool.query(
      "SELECT types FROM place_provider_reference WHERE provider_place_id=$1",
      [located],
    );
    expect(refetched.rows[0].types).toEqual(types);
    // With the flag off, references carry no cached location.
    flags.mapMvp = false;
    try {
      const refs = await listExternalReferences(state([layer]), city, alice, 0);
      expect(refs.references.every((r) => r.location === undefined)).toBe(true);
    } finally {
      flags.mapMvp = true;
    }
  });
  it("ignores search, area, dates and non-place types from the URL", async () => {
    const parsed = parseMapQuery({
      q: "noodles",
      scope: "city",
      area: "-95.6,29.6,-95.3,29.8",
      date: "today",
      types: "event",
    });
    expect(parsed).toMatchObject({ q: "noodles", scope: "city" });
    const normalized = mvpMapState({ ...parsed, city: "houston", layers: [] });
    expect(normalized).toMatchObject({
      q: "",
      scope: "layers",
      area: undefined,
      date: "upcoming",
      types: ["place"],
    });
    // A city-wide search URL then returns only the (empty) layer union.
    const result = await runMapQuery(normalized, city, alice);
    expect(result).toMatchObject({ searchScope: "layers", total: 0 });
  });
});
describe("events attached to places in a layer", () => {
  let layer: { id: string; slug: string };
  let key: string;
  beforeAll(async () => {
    const created = await createLayerFromGoogle(editor, {
      title: "Circle events",
      city: "houston",
      audience: "group",
      groupId,
      providerPlaceIds: [placeId(20)],
    });
    layer = created.layer;
    key = `subject:${await subjectOf(placeId(20))}`;
  });
  it("stores wall-clock times in the city's zone and shows them on the map", async () => {
    const { event } = await createLayerEvent(alice, layer.id, {
      key,
      title: "Night market",
      startsAt: "2099-11-07T18:00",
      endsAt: "2099-11-07T22:00",
      note: "Cash only",
    });
    expect(event).toMatchObject({
      key,
      layer: layer.slug,
      title: "Night market",
      startTime: "2099-11-08T00:00:00.000Z",
      endTime: "2099-11-08T04:00:00.000Z",
    });
    const result = await runMapQuery(state([layer.slug]), city, viewer);
    expect(result.events[key]?.map((e) => e.title)).toEqual(["Night market"]);
    // Outsiders never get the layer, so never its events.
    const outside = await runMapQuery(state([layer.slug]), city, bob);
    expect(outside.events).toEqual({});
  });
  it("lets editors change and delete events; viewers and outsiders cannot", async () => {
    const { event } = await createLayerEvent(editor, layer.id, {
      key,
      title: "Tasting",
      startsAt: "2099-12-01T12:00",
      endsAt: "2099-12-01T13:00",
    });
    await expect(
      createLayerEvent(viewer, layer.id, {
        key,
        title: "Nope",
        startsAt: "2099-12-01T12:00",
        endsAt: "2099-12-01T13:00",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      deleteLayerEvent(bob, layer.id, event.id),
    ).rejects.toMatchObject({ status: 404 });
    const updated = await updateLayerEvent(editor, layer.id, event.id, {
      title: "Tasting menu",
      endsAt: "2099-12-01T14:00",
    });
    expect(updated.event).toMatchObject({
      title: "Tasting menu",
      startTime: "2099-12-01T18:00:00.000Z",
      endTime: "2099-12-01T20:00:00.000Z",
    });
    await deleteLayerEvent(editor, layer.id, event.id);
    const titles = (await listLayerEvents(viewer, layer.id)).map(
      (e) => e.title,
    );
    expect(titles).not.toContain("Tasting menu");
  });
  it("rejects places outside the layer, reversed times and overlong spans", async () => {
    await expect(
      createLayerEvent(alice, layer.id, {
        key: `subject:${crypto.randomUUID()}`,
        title: "Elsewhere",
        startsAt: "2099-12-01T12:00",
        endsAt: "2099-12-01T13:00",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createLayerEvent(alice, layer.id, {
        key,
        title: "Backwards",
        startsAt: "2099-12-01T12:00",
        endsAt: "2099-12-01T11:00",
      }),
    ).rejects.toThrow();
    await expect(
      createLayerEvent(alice, layer.id, {
        key,
        title: "Forever",
        startsAt: "2099-12-01T12:00",
        endsAt: "2100-02-01T12:00",
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATES" });
  });
  it("keeps past events in the editor but off the map", async () => {
    await createLayerEvent(alice, layer.id, {
      key,
      title: "Last year",
      startsAt: "2020-01-01T10:00",
      endsAt: "2020-01-01T11:00",
    });
    const result = await runMapQuery(state([layer.slug]), city, alice);
    expect(result.events[key]?.map((e) => e.title)).not.toContain("Last year");
    const all = await listLayerEvents(alice, layer.id);
    expect(all.map((e) => e.title)).toContain("Last year");
  });
  it("removing the place removes its events", async () => {
    await pool.query(
      "DELETE FROM layer_item WHERE layer_id=$1 AND subject_id=$2",
      [layer.id, key.slice(8)],
    );
    expect(await listLayerEvents(alice, layer.id)).toEqual([]);
  });
});
