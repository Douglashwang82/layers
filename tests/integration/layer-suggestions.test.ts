import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

/*
 * The route reads the session through next/headers and the session module;
 * only those accessors are stubbed. The Anthropic model is replaced through
 * the deps seam (service tests) or by overriding the adapter factory (route
 * tests). No test makes a live provider call.
 */
const session = vi.hoisted(() => ({
  actor: null as { id: string; role: string } | null,
}));
const routeModel = vi.hoisted(() => ({
  generate: undefined as undefined | ((payload: never) => Promise<unknown>),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === "locale" ? { value: "zh-TW" } : undefined),
    getAll: () => [],
    has: () => false,
  }),
}));
vi.mock("../../apps/web/src/lib/session", async (original) => ({
  ...(await original<typeof import("../../apps/web/src/lib/session")>()),
  currentActor: async () => session.actor,
}));
vi.mock("../../packages/database/src", async (original) => ({
  ...(await original<typeof import("../../packages/database/src")>()),
  createLayerSuggestionModel: () => ({
    generate: (payload: unknown) => routeModel.generate!(payload as never),
  }),
}));

import { pool } from "../../packages/database/src";
import { GET, POST } from "../../apps/web/src/app/api/v1/[...path]/route";
import { createGroup } from "../../apps/web/src/features/groups/service";
import { createLayer } from "../../apps/web/src/features/layers/service";
import { createCustomPlaceInLayer } from "../../apps/web/src/features/custom-places/service";
import { mvpMapState } from "../../apps/web/src/features/map/request";
import {
  buildSuggestionSnapshot,
  generateLayerSuggestions,
  getLayerSuggestions,
  snapshotHash,
  suggestionGlobalBudget,
  suggestionUserBudget,
  type SuggestionDeps,
} from "../../apps/web/src/features/map/suggestions";
import { flags } from "../../apps/web/src/lib/config";
import type { Actor, MapState } from "../../packages/shared/src";

const user = (): Actor => ({ id: crypto.randomUUID(), role: "USER" });
const alice = user(),
  bob = user(),
  carol = user(),
  dave = user();
const users = [alice, bob, carol, dave];
const city = {
  id: "00000000-0000-4000-8000-000000001001",
  slug: "houston",
  name: "Houston",
  timezone: "America/Chicago",
  latitude: 29.7604,
  longitude: -95.3698,
};
const run = crypto.randomUUID().slice(0, 8);
const now = new Date();
const model = "claude-haiku-5-5";
const state = (...layers: string[]): MapState =>
  mvpMapState({
    city: "houston",
    layers,
    date: "upcoming",
    q: "",
    scope: "layers",
    view: "map",
    page: 1,
  } as MapState);
const places = {
  alpha: crypto.randomUUID(),
  beta: crypto.randomUUID(),
  demo: crypto.randomUUID(),
  hidden: crypto.randomUUID(),
  expired: crypto.randomUUID(),
};
let groupId: string;
let priv: { id: string; slug: string };
let groupLayer: { id: string; slug: string };
let publicLayer: { id: string; slug: string };
let bobLayer: { id: string; slug: string };
let customKey = "";

async function addPlace(
  id: string,
  name: string,
  over: { demo?: boolean; status?: string } = {},
) {
  await pool.query(
    `INSERT INTO place(id,slug,name,name_chinese,image,category,city_id,neighborhood,address,latitude,longitude,status,is_demo)
     VALUES($1,$2,$3,$4,'https://example.test/x.png','Taiwanese',$5,'PRIVATEHOOD','1 PRIVATE ADDRESS ST',29.7,-95.4,$6,$7)`,
    [
      id,
      `sug-${run}-${id.slice(0, 8)}`,
      name,
      `${name}中`,
      city.id,
      over.status ?? "approved",
      over.demo ?? false,
    ],
  );
}
async function addItem(
  layerId: string,
  placeId: string,
  extra = "",
  note = "PRIVATENOTE",
) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO layer_item(layer_id,place_id,note,position${extra ? ",valid_until" : ""})
     VALUES($1,$2,$3,0${extra ? `,${extra}` : ""}) RETURNING id`,
    [layerId, placeId, note],
  );
  return rows[0].id;
}
async function addEvent(itemId: string, title: string, day = "2099-11-07") {
  await pool.query(
    `INSERT INTO layer_item_event(layer_item_id,title,title_chinese,start_time,end_time,note,created_by,updated_by)
     VALUES($1,$2,'',$3,$4,'PRIVATEEVENTNOTE',$5,$5)`,
    [itemId, title, `${day}T18:00:00Z`, `${day}T22:00:00Z`, alice.id],
  );
}
type FirstPayload = { layers: { facts: { id: string }[] }[] };
const tip = (factIds: string[], over: Record<string, unknown> = {}) => ({
  layerRef: "L1",
  title: "Add an event",
  body: "This layer has places but no events yet.",
  factIds,
  ...over,
});
function fake(
  produce: (payload: FirstPayload) => unknown = (payload) => ({
    suggestions: [tip([payload.layers[0].facts[0].id])],
  }),
) {
  const generate = vi.fn(async (payload: unknown) =>
    produce(payload as FirstPayload),
  );
  const deps: SuggestionDeps = { model: { generate }, modelId: model };
  return { generate, deps };
}
async function rows(userId: string) {
  const r = await pool.query(
    "SELECT * FROM layer_suggestion_run WHERE user_id=$1",
    [userId],
  );
  return r.rows;
}
async function counter(key: string) {
  const r = await pool.query<{ count: number }>(
    "SELECT count FROM rate_limit WHERE key=$1 AND expires_at>now()",
    [key],
  );
  return r.rows[0]?.count ?? 0;
}
const globalKey = "layer-suggestions:global";

beforeAll(async () => {
  for (const [i, u] of users.entries())
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [u.id, `Suggest ${i}`, `${u.id}@layer-suggestions.example`, u.role],
    );
  Object.assign(flags, { layerWrites: true, layerCustomPlaces: true });
  await addPlace(places.alpha, "Alpha Cafe");
  await addPlace(places.beta, "Beta Noodles");
  await addPlace(places.demo, "Demo Diner", { demo: true });
  await addPlace(places.hidden, "Hidden Hut", { status: "pending" });
  await addPlace(places.expired, "Expired Eatery");
  groupId = (
    await createGroup(alice, { name: `Suggest Circle ${run}`, city: "houston" })
  ).group.id;
  await pool.query(
    "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'viewer')",
    [groupId, carol.id],
  );
  priv = (
    await createLayer(alice, {
      title: `Private ${run}`,
      titleChinese: "私人",
      city: "houston",
    })
  ).layer;
  groupLayer = (
    await createLayer(alice, {
      title: `Circle ${run}`,
      city: "houston",
      audience: "group",
      groupId,
    })
  ).layer;
  publicLayer = (
    await createLayer(alice, { title: `Public ${run}`, city: "houston" })
  ).layer;
  await pool.query(
    "UPDATE layer SET audience='public',review_status='approved',lifecycle='active' WHERE id=$1",
    [publicLayer.id],
  );
  bobLayer = (await createLayer(bob, { title: `Bobs ${run}`, city: "houston" }))
    .layer;
  const alphaItem = await addItem(priv.id, places.alpha);
  await addItem(priv.id, places.beta);
  const demoItem = await addItem(priv.id, places.demo);
  const hiddenItem = await addItem(priv.id, places.hidden);
  const expiredItem = await addItem(
    priv.id,
    places.expired,
    "now() - interval '1 day'",
  );
  await addEvent(alphaItem, "Alpha tasting");
  await addEvent(demoItem, "Demo party");
  await addEvent(hiddenItem, "Hidden party");
  await addEvent(expiredItem, "Expired party");
  const custom = await createCustomPlaceInLayer(alice, priv.id, {
    name: "Custom Corner",
    note: "PRIVATECUSTOMNOTE",
  });
  customKey = custom.key;
  const groupAlpha = await addItem(groupLayer.id, places.alpha);
  await addEvent(groupAlpha, "Circle night");
  await addItem(publicLayer.id, places.alpha);
  await addItem(bobLayer.id, places.beta);
});
afterAll(async () => {
  const ids = users.map((u) => u.id);
  await pool.query(
    "DELETE FROM layer WHERE created_by=ANY($1::uuid[]) OR owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  await pool.query(
    "DELETE FROM custom_place WHERE owner_user_id=ANY($1::uuid[]) OR owner_group_id=$2",
    [ids, groupId],
  );
  await pool.query("DELETE FROM place WHERE slug LIKE $1", [`sug-${run}-%`]);
  await pool.query('DELETE FROM "group" WHERE id=$1', [groupId]);
  await pool.query(
    "DELETE FROM analytics_event WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query("DELETE FROM rate_limit WHERE key = ANY($1::text[])", [
    ids.flatMap((id) => [`layer-suggestions:user:${id}`, `contribution:${id}`]),
  ]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
});

describe("snapshot allowlist", () => {
  it("builds only authorized, non-demo, current content for the owner", async () => {
    const snap = await buildSuggestionSnapshot(
      state(priv.slug),
      city,
      alice,
      "en",
      now,
    );
    expect(snap).not.toBeNull();
    const text = JSON.stringify(snap!.payload);
    for (const present of ["Alpha Cafe", "Beta Noodles", "Alpha tasting"])
      expect(text).toContain(present);
    for (const absent of [
      "Demo Diner",
      "Demo party",
      "Hidden Hut",
      "Hidden party",
      "Expired Eatery",
      "Expired party",
      "PRIVATE",
      priv.slug,
      priv.id,
      "1 PRIVATE",
      places.alpha,
      "29.7",
      "-95.4",
    ])
      expect(text).not.toContain(absent);
    const facts = snap!.payload.layers[0].facts;
    expect(facts.find((f) => f.kind === "catalog_places")?.value).toBe(3);
    expect(facts.find((f) => f.kind === "upcoming_event_count")?.value).toBe(1);
    expect(snap!.payload.layers[0].viewerRole).toBe("owner");
    expect(snap!.refs.get("L1")).toEqual({ slug: priv.slug });
  });

  it("includes custom places only while the flag and layer access allow it", async () => {
    const owner = await buildSuggestionSnapshot(
      state(priv.slug),
      city,
      alice,
      "en",
      now,
    );
    expect(JSON.stringify(owner!.payload)).toContain("Custom Corner");
    expect(JSON.stringify(owner!.payload)).not.toContain("PRIVATECUSTOMNOTE");
    expect(customKey).toMatch(/^custom:/);
    flags.layerCustomPlaces = false;
    try {
      const off = await buildSuggestionSnapshot(
        state(priv.slug),
        city,
        alice,
        "en",
        now,
      );
      expect(JSON.stringify(off!.payload)).not.toContain("Custom Corner");
    } finally {
      flags.layerCustomPlaces = true;
    }
    expect(
      await buildSuggestionSnapshot(state(priv.slug), city, bob, "en", now),
    ).toBeNull();
  });

  it("returns nothing for non-members and for missing layers", async () => {
    for (const actor of [bob, carol])
      expect(
        await buildSuggestionSnapshot(state(priv.slug), city, actor, "en", now),
      ).toBeNull();
    expect(
      await buildSuggestionSnapshot(
        state("no-such-layer"),
        city,
        alice,
        "en",
        now,
      ),
    ).toBeNull();
  });

  it("drops an archived layer and system layers", async () => {
    const { rows } = await pool.query<{ slug: string }>(
      "SELECT slug FROM layer WHERE owner_kind='system' LIMIT 1",
    );
    if (rows[0])
      expect(
        await buildSuggestionSnapshot(
          state(rows[0].slug),
          city,
          alice,
          "en",
          now,
        ),
      ).toBeNull();
    const archived = (
      await createLayer(alice, { title: `Archived ${run}`, city: "houston" })
    ).layer;
    await pool.query("UPDATE layer SET lifecycle='archived' WHERE id=$1", [
      archived.id,
    ]);
    expect(
      await buildSuggestionSnapshot(
        state(archived.slug),
        city,
        alice,
        "en",
        now,
      ),
    ).toBeNull();
  });

  it("serves group layers to members only, and stops when membership is revoked", async () => {
    const asMember = await buildSuggestionSnapshot(
      state(groupLayer.slug),
      city,
      carol,
      "en",
      now,
    );
    expect(asMember?.payload.layers[0].viewerRole).toBe("viewer");
    expect(JSON.stringify(asMember!.payload)).toContain("Circle night");
    expect(
      await buildSuggestionSnapshot(
        state(groupLayer.slug),
        city,
        dave,
        "en",
        now,
      ),
    ).toBeNull();
    await pool.query(
      "UPDATE group_member SET role='viewer' WHERE group_id=$1 AND user_id=$2",
      [groupId, carol.id],
    );
    const revoked = user();
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [
        revoked.id,
        "Revoked",
        `${revoked.id}@layer-suggestions.example`,
        "USER",
      ],
    );
    users.push(revoked);
    await pool.query(
      "INSERT INTO group_member(group_id,user_id,role) VALUES($1,$2,'viewer')",
      [groupId, revoked.id],
    );
    expect(
      await buildSuggestionSnapshot(
        state(groupLayer.slug),
        city,
        revoked,
        "en",
        now,
      ),
    ).not.toBeNull();
    await pool.query(
      "DELETE FROM group_member WHERE group_id=$1 AND user_id=$2",
      [groupId, revoked.id],
    );
    expect(
      await buildSuggestionSnapshot(
        state(groupLayer.slug),
        city,
        revoked,
        "en",
        now,
      ),
    ).toBeNull();
  });
});

describe("generate and cache", () => {
  it("returns none without calling the model when nothing is usable", async () => {
    const { generate, deps } = fake();
    expect(
      await generateLayerSuggestions(
        state("none" as never),
        city,
        dave,
        "en",
        deps,
        now,
      ),
    ).toEqual({ status: "none" });
    expect(
      await generateLayerSuggestions(
        state(priv.slug),
        city,
        bob,
        "en",
        deps,
        now,
      ),
    ).toEqual({ status: "none" });
    expect(generate).not.toHaveBeenCalled();
    await expect(
      generateLayerSuggestions(state(priv.slug), city, null, "en", deps, now),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("caches a result; a hit makes no model call and spends no budget", async () => {
    const { generate, deps } = fake();
    const first = await generateLayerSuggestions(
      state(priv.slug),
      city,
      alice,
      "en",
      deps,
      now,
    );
    expect(first).toMatchObject({
      status: "ready",
      suggestions: [{ type: "layer_tip", layerSlug: priv.slug }],
    });
    expect(JSON.stringify(first)).not.toContain("factIds");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await rows(alice.id)).toHaveLength(1);
    const userBefore = await counter(`layer-suggestions:user:${alice.id}`);
    const globalBefore = await counter(globalKey);
    const second = await generateLayerSuggestions(
      state(priv.slug),
      city,
      alice,
      "en",
      deps,
      now,
    );
    expect(second).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await counter(`layer-suggestions:user:${alice.id}`)).toBe(
      userBefore,
    );
    expect(await counter(globalKey)).toBe(globalBefore);
    expect(
      await getLayerSuggestions(state(priv.slug), city, alice, "en", now, deps),
    ).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("keeps locale and layer contents in the cache key", async () => {
    const { deps } = fake();
    const en = await getLayerSuggestions(
      state(priv.slug),
      city,
      alice,
      "en",
      now,
      deps,
    );
    const zh = await getLayerSuggestions(
      state(priv.slug),
      city,
      alice,
      "zh-TW",
      now,
      deps,
    );
    expect(en.status).toBe("ready");
    expect(zh).toEqual({ status: "none" });
    const snap = await buildSuggestionSnapshot(
      state(priv.slug),
      city,
      alice,
      "en",
      now,
    );
    expect(snapshotHash(snap!.payload, model)).toHaveLength(64);
    expect(snapshotHash(snap!.payload, "other-model-id")).not.toBe(
      snapshotHash(snap!.payload, model),
    );
  });

  it("never serves one user's cached row to another user", async () => {
    const a = fake();
    const b = fake();
    const forBob = await generateLayerSuggestions(
      state(publicLayer.slug),
      city,
      bob,
      "en",
      a.deps,
      now,
    );
    expect(forBob.status).toBe("ready");
    const seen = await getLayerSuggestions(
      state(publicLayer.slug),
      city,
      carol,
      "en",
      now,
      b.deps,
    );
    expect(seen).toEqual({ status: "none" });
    await generateLayerSuggestions(
      state(publicLayer.slug),
      city,
      carol,
      "en",
      b.deps,
      now,
    );
    expect(b.generate).toHaveBeenCalledTimes(1);
    expect(await rows(bob.id)).toHaveLength(1);
    expect(await rows(carol.id)).toHaveLength(1);
  });

  it("counts cache misses only, user budget first, short-circuiting the global counter", async () => {
    const { generate, deps } = fake();
    const key = `layer-suggestions:user:${dave.id}`;
    await pool.query(
      "INSERT INTO rate_limit(key,count,expires_at) VALUES($1,$2,now()+interval '1 hour') ON CONFLICT(key) DO UPDATE SET count=$2,expires_at=now()+interval '1 hour'",
      [key, suggestionUserBudget.limit],
    );
    const globalBefore = await counter(globalKey);
    // dave sees bob's public layer content: a miss for dave.
    await expect(
      generateLayerSuggestions(
        state(publicLayer.slug),
        city,
        dave,
        "en",
        deps,
        now,
      ),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(await counter(globalKey)).toBe(globalBefore);
    expect(generate).not.toHaveBeenCalled();
    expect(await rows(dave.id)).toHaveLength(0);
    await pool.query("DELETE FROM rate_limit WHERE key=$1", [key]);
  });

  it("rejects when the global budget is spent, before any model call", async () => {
    const saved = await pool.query(
      "SELECT count,expires_at FROM rate_limit WHERE key=$1",
      [globalKey],
    );
    await pool.query(
      "INSERT INTO rate_limit(key,count,expires_at) VALUES($1,$2,now()+interval '1 hour') ON CONFLICT(key) DO UPDATE SET count=$2,expires_at=now()+interval '1 hour'",
      [globalKey, suggestionGlobalBudget.limit],
    );
    try {
      const { generate, deps } = fake();
      await expect(
        generateLayerSuggestions(
          state(bobLayer.slug),
          city,
          bob,
          "en",
          deps,
          now,
        ),
      ).rejects.toMatchObject({ status: 429 });
      expect(generate).not.toHaveBeenCalled();
    } finally {
      if (saved.rows[0])
        await pool.query(
          "UPDATE rate_limit SET count=$2,expires_at=$3 WHERE key=$1",
          [globalKey, saved.rows[0].count, saved.rows[0].expires_at],
        );
      else await pool.query("DELETE FROM rate_limit WHERE key=$1", [globalKey]);
      await pool.query("DELETE FROM rate_limit WHERE key=$1", [
        `layer-suggestions:user:${bob.id}`,
      ]);
    }
  });

  it("returns 503 when the key or model is unset or invalid, and none for GET", async () => {
    const saved = {
      key: process.env.ANTHROPIC_API_KEY,
      model: process.env.LAYER_SUGGESTIONS_LLM_MODEL,
    };
    try {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.LAYER_SUGGESTIONS_LLM_MODEL;
      await expect(
        generateLayerSuggestions(state(bobLayer.slug), city, bob, "en"),
      ).rejects.toMatchObject({ status: 503, code: "SUGGESTIONS_UNAVAILABLE" });
      process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
      await expect(
        generateLayerSuggestions(state(bobLayer.slug), city, bob, "en"),
      ).rejects.toMatchObject({ status: 503 });
      process.env.LAYER_SUGGESTIONS_LLM_MODEL = "not a model!";
      await expect(
        generateLayerSuggestions(state(bobLayer.slug), city, bob, "en"),
      ).rejects.toMatchObject({ status: 503 });
      expect(
        await getLayerSuggestions(state(bobLayer.slug), city, bob, "en", now),
      ).toEqual({ status: "none" });
    } finally {
      for (const [name, value] of [
        ["ANTHROPIC_API_KEY", saved.key],
        ["LAYER_SUGGESTIONS_LLM_MODEL", saved.model],
      ] as const)
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
  });

  it("returns 502 and caches nothing when the model fails or every entry is dropped", async () => {
    const failing = fake(() => {
      throw new Error("boom with PRIVATE text");
    });
    const all = fake(() => ({
      suggestions: [tip(["L1.f999"]), tip([], { layerRef: "L9" })],
    }));
    const malformed = fake(() => ({ nope: true }));
    const rowsBefore = (await rows(bob.id)).length;
    for (const f of [failing, all, malformed]) {
      const error = await generateLayerSuggestions(
        state(bobLayer.slug),
        city,
        bob,
        "en",
        f.deps,
        now,
      ).catch((e) => e);
      expect(error).toMatchObject({ status: 502, code: "SUGGESTIONS_FAILED" });
      expect(error.message).not.toContain("PRIVATE");
      expect(f.generate).toHaveBeenCalledTimes(1);
    }
    expect((await rows(bob.id)).length).toBe(rowsBefore);
    // A failed call still counted against the budget.
    expect(
      await counter(`layer-suggestions:user:${bob.id}`),
    ).toBeGreaterThanOrEqual(3);
  });

  it("caches an empty result when the model returned zero entries", async () => {
    const empty = fake(() => ({ suggestions: [] }));
    const first = await generateLayerSuggestions(
      state(bobLayer.slug),
      city,
      bob,
      "en",
      empty.deps,
      now,
    );
    expect(first).toMatchObject({ status: "ready", suggestions: [] });
    const again = await generateLayerSuggestions(
      state(bobLayer.slug),
      city,
      bob,
      "en",
      empty.deps,
      now,
    );
    expect(again).toEqual(first);
    expect(empty.generate).toHaveBeenCalledTimes(1);
  });

  it("does not serve expired rows, replaces them, and sweeps everyone's expired rows", async () => {
    const snap = await buildSuggestionSnapshot(
      state(priv.slug),
      city,
      alice,
      "zh-TW",
      now,
    );
    const hash = snapshotHash(snap!.payload, model);
    const stale = JSON.stringify([
      {
        type: "layer_tip",
        layerRef: "L1",
        title: "Stale",
        body: "Stale",
        factIds: ["L1.f1"],
      },
    ]);
    const insertExpired = (userId: string, h: string) =>
      pool.query(
        `INSERT INTO layer_suggestion_run(user_id,snapshot_hash,locale,suggestions,model,prompt_version,created_at,expires_at)
         VALUES($1,$2,'en',$3::jsonb,$4,'v1',now()-interval '2 days',now()-interval '1 day')`,
        [userId, h, stale, model],
      );
    await insertExpired(alice.id, hash);
    await insertExpired(dave.id, "e".repeat(64));
    const { generate, deps } = fake();
    expect(
      await getLayerSuggestions(
        state(priv.slug),
        city,
        alice,
        "zh-TW",
        now,
        deps,
      ),
    ).toEqual({ status: "none" });
    const result = await generateLayerSuggestions(
      state(priv.slug),
      city,
      alice,
      "zh-TW",
      deps,
      now,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("Stale");
    const mine = await pool.query(
      "SELECT expires_at>now() AS live FROM layer_suggestion_run WHERE user_id=$1 AND snapshot_hash=$2",
      [alice.id, hash],
    );
    expect(mine.rows).toEqual([{ live: true }]);
    expect(await rows(dave.id)).toHaveLength(0);
  });

  it("survives two concurrent first writes with one row", async () => {
    const racer = user();
    await pool.query(
      'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
      [racer.id, "Racer", `${racer.id}@layer-suggestions.example`, "USER"],
    );
    users.push(racer);
    const { generate, deps } = fake();
    const call = () =>
      generateLayerSuggestions(
        state(publicLayer.slug),
        city,
        racer,
        "en",
        deps,
        now,
      );
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.status).toBe("ready");
    expect(b.status).toBe("ready");
    expect(generate.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(await rows(racer.id)).toHaveLength(1);
  });
});

describe("HTTP route", () => {
  const url = (path: string, layers: string[] = [priv.slug]) =>
    `http://localhost:3000/api/v1/${path}?city=houston&layers=${layers.join(",")}`;
  const call = (
    method: "GET" | "POST",
    actor: Actor | null,
    headers: Record<string, string> = {},
    layers?: string[],
  ) => {
    session.actor = actor;
    const handler = method === "GET" ? GET : POST;
    return handler(
      new NextRequest(url("map/suggestions", layers), {
        method,
        headers,
        ...(method === "POST" ? { body: "" } : {}),
      }),
      { params: Promise.resolve({ path: ["map", "suggestions"] }) },
    );
  };
  const env = {
    key: process.env.ANTHROPIC_API_KEY,
    model: process.env.LAYER_SUGGESTIONS_LLM_MODEL,
  };
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    process.env.LAYER_SUGGESTIONS_LLM_MODEL = model;
  });
  afterEach(() => {
    session.actor = null;
    flags.layerSuggestions = false;
    for (const [name, value] of [
      ["ANTHROPIC_API_KEY", env.key],
      ["LAYER_SUGGESTIONS_LLM_MODEL", env.model],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });

  it("returns 404 DISABLED for GET and POST when the flag is off", async () => {
    flags.layerSuggestions = false;
    for (const method of ["GET", "POST"] as const)
      for (const actor of [null, alice]) {
        const response = await call(method, actor);
        expect(response.status).toBe(404);
        expect((await response.json()).error.code).toBe("DISABLED");
      }
  });

  it("rejects a POST from another origin", async () => {
    flags.layerSuggestions = true;
    const response = await call("POST", alice, {
      origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("BAD_ORIGIN");
  });

  it("answers anonymous GET with none and requires a session for POST", async () => {
    flags.layerSuggestions = true;
    const get = await call("GET", null);
    expect(get.status).toBe(200);
    expect(get.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await get.json()).data).toEqual({ status: "none" });
    expect((await call("POST", null)).status).toBe(401);
  });

  it("generates over POST, caches, and reads over GET with private no-store headers", async () => {
    flags.layerSuggestions = true;
    routeModel.generate = vi.fn(async (payload: FirstPayload) => ({
      suggestions: [
        tip([payload.layers[0].facts[0].id], { title: "From the route" }),
      ],
    }));
    const generate = routeModel.generate as ReturnType<typeof vi.fn>;
    const before = await call("GET", alice, {}, [groupLayer.slug]);
    expect((await before.json()).data).toEqual({ status: "none" });
    const post = await call("POST", alice, {}, [groupLayer.slug]);
    expect(post.status).toBe(200);
    expect(post.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await post.json()).data;
    expect(body.status).toBe("ready");
    expect(body.suggestions).toEqual([
      {
        type: "layer_tip",
        title: "From the route",
        body: "This layer has places but no events yet.",
        layerSlug: groupLayer.slug,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("factIds");
    // The route resolved the zh-TW cookie into the payload.
    expect(JSON.stringify(generate.mock.calls[0][0])).toContain(
      '"locale":"zh-TW"',
    );
    const get = await call("GET", alice, {}, [groupLayer.slug]);
    expect(get.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await get.json()).data).toEqual(body);
    await call("POST", alice, {}, [groupLayer.slug]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("maps configuration and model failures to 503 and 502 without model text", async () => {
    flags.layerSuggestions = true;
    delete process.env.LAYER_SUGGESTIONS_LLM_MODEL;
    const unavailable = await call("POST", bob, {}, [bobLayer.slug]);
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.code).toBe(
      "SUGGESTIONS_UNAVAILABLE",
    );
    process.env.LAYER_SUGGESTIONS_LLM_MODEL = model;
    routeModel.generate = async () => ({
      suggestions: [tip(["L1.f999"], { body: "LEAK https://evil.example" })],
    });
    const failed = await call("POST", bob, {}, [bobLayer.slug]);
    expect(failed.status).toBe(502);
    const text = JSON.stringify(await failed.json());
    expect(text).toContain("SUGGESTIONS_FAILED");
    expect(text).not.toContain("evil");
  });
});
