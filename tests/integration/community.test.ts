import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { pool } from "../../packages/database/src";
import {
  recommend,
  rsvp,
  save,
  follow,
  createSighting,
  submitContent,
  moderate,
  editContent,
  contributionLimit,
} from "../../apps/web/src/features/community/service";
import {
  listContent,
  getContent,
} from "../../apps/web/src/features/catalog/repository";
import { listInput, type Actor } from "../../packages/shared/src";
const member: Actor = { id: crypto.randomUUID(), role: "USER" },
  other: Actor = { id: crypto.randomUUID(), role: "USER" },
  admin: Actor = { id: crypto.randomUUID(), role: "ADMIN" };
const placeId = "00000000-0000-4000-8000-000000005000";
const cityId = "00000000-0000-4000-8000-000000001001";
const organizerId = "00000000-0000-4000-8000-000000004000";
let eventId: string;
let sightingId: string;
beforeAll(async () => {
  for (const actor of [member, other, admin])
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [actor.id, "Integration Test", actor.id + "@example.test", actor.role],
    );
});
afterAll(async () => {
  const ids = [member.id, other.id, admin.id];
  await pool.query(
    "DELETE FROM moderation_action WHERE actor_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query("DELETE FROM submission WHERE user_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query(
    "DELETE FROM product_sighting WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await pool.query("DELETE FROM place_note WHERE user_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query("DELETE FROM event WHERE submitted_by=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
});
describe("real Postgres community flows", () => {
  it("guards unauthenticated mutations", async () => {
    await expect(
      recommend(null, placeId, { positive: true }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("upserts a single vote and queues notes", async () => {
    await recommend(member, placeId, {
      positive: true,
      note: "A lovely bowl of noodles.",
    });
    await recommend(member, placeId, { positive: false });
    const result = await pool.query(
      "SELECT positive FROM place_recommendation WHERE place_id=$1 AND user_id=$2",
      [placeId, member.id],
    );
    expect(result.rows).toEqual([{ positive: false }]);
    expect(
      (
        await pool.query("SELECT status FROM place_note WHERE user_id=$1", [
          member.id,
        ])
      ).rows[0].status,
    ).toBe("pending");
  });
  it("saves and follows idempotently", async () => {
    await save(member, "places", placeId, true);
    await save(member, "places", placeId, true);
    expect(
      (
        await pool.query("SELECT * FROM saved_place WHERE user_id=$1", [
          member.id,
        ])
      ).rowCount,
    ).toBe(1);
    await follow(member, organizerId, true);
    await follow(member, organizerId, false);
    expect(
      (
        await pool.query("SELECT * FROM organization_follow WHERE user_id=$1", [
          member.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("submits, protects, and approves an event", async () => {
    const e = await submitContent(member, "events", {
      name: "Integration Gathering",
      description: "A gathering created by the automated integration suite.",
      cityId,
      organizerId,
      neighborhood: "Midtown",
      address: "100 Test Lane",
      latitude: 29.7,
      longitude: -95.4,
      category: "Social",
      venue: "Test Hall",
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 90000000).toISOString(),
      capacity: 1,
    });
    eventId = e.id;
    await expect(getContent("events", eventId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      moderate(member, {
        entityType: "events",
        entityId: eventId,
        action: "approved",
        reason: "Test",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await moderate(admin, {
      entityType: "events",
      entityId: eventId,
      action: "approved",
      reason: "Reviewed test event",
    });
    expect((await getContent("events", eventId)).status).toBe("approved");
  });
  it("serializes concurrent RSVPs to enforce capacity and supports cancellation", async () => {
    const result = await Promise.allSettled([
      rsvp(member, eventId, true),
      rsvp(other, eventId, true),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await pool.query<{ user_id: string }>(
      "SELECT user_id FROM event_rsvp WHERE event_id=$1",
      [eventId],
    );
    expect(rows.rowCount).toBe(1);
    const winner = rows.rows[0].user_id === member.id ? member : other;
    await rsvp(winner, eventId, true);
    await rsvp(winner, eventId, false);
    expect(
      (
        await pool.query("SELECT * FROM event_rsvp WHERE event_id=$1", [
          eventId,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("supports English and Traditional Chinese search", async () => {
    expect(
      (await listContent("places", listInput.parse({ q: "牛肉麵" }))).total,
    ).toBeGreaterThan(0);
    expect(
      (await listContent("places", listInput.parse({ q: "beef noodle" })))
        .total,
    ).toBeGreaterThan(0);
    expect(
      (await listContent("products", listInput.parse({ q: "義美" }))).total,
    ).toBeGreaterThan(0);
  });
  it("rejects capacity edits below attendance and audits valid edits", async () => {
    await rsvp(member, eventId, true);
    const current = await getContent("events", eventId);
    await editContent(admin, "events", eventId, {
      ...current,
      name: "Updated integration gathering",
      capacity: 2,
    });
    await rsvp(other, eventId, true);
    await expect(
      editContent(admin, "events", eventId, { ...current, capacity: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getContent("events", eventId)).name).toBe(
      "Updated integration gathering",
    );
    await rsvp(member, eventId, false);
    await rsvp(other, eventId, false);
  });
  it("uses shared rate limits across contribution calls", async () => {
    await pool.query("DELETE FROM rate_limit WHERE key=$1", [
      `contribution:${member.id}`,
    ]);
    for (let i = 0; i < 30; i++) await contributionLimit(member);
    await expect(contributionLimit(member)).rejects.toMatchObject({
      status: 429,
    });
    await pool.query("DELETE FROM rate_limit WHERE key=$1", [
      `contribution:${member.id}`,
    ]);
  });
  it("escapes search wildcard input and keeps hidden votes hidden", async () => {
    expect(
      (await listContent("places", listInput.parse({ q: "%' OR 1=1 --" })))
        .total,
    ).toBe(0);
    const vote = (
      await pool.query<{ id: string }>(
        "SELECT id FROM place_recommendation WHERE user_id=$1 AND place_id=$2",
        [member.id, placeId],
      )
    ).rows[0];
    await moderate(admin, {
      entityType: "recommendations",
      entityId: vote.id,
      action: "hidden",
      reason: "Test hidden vote",
    });
    await recommend(member, placeId, { positive: true });
    expect(
      (
        await pool.query(
          "SELECT status FROM place_recommendation WHERE id=$1",
          [vote.id],
        )
      ).rows[0].status,
    ).toBe("hidden");
  });
  it("creates moderated sightings and records an audit trail", async () => {
    const result = await createSighting(member, {
      productId: "00000000-0000-4000-8000-000000007000",
      placeId: "00000000-0000-4000-8000-000000005006",
      price: 4.5,
      observedAt: new Date().toISOString(),
    });
    sightingId = result.id;
    expect(result.status).toBe("pending");
    await moderate(admin, {
      entityType: "sightings",
      entityId: sightingId,
      action: "approved",
      reason: "Reviewed sighting",
    });
    expect(
      (
        await pool.query("SELECT * FROM moderation_action WHERE entity_id=$1", [
          sightingId,
        ])
      ).rowCount,
    ).toBe(1);
    await expect(
      createSighting(member, {
        productId: "00000000-0000-4000-8000-000000007000",
        placeId,
        observedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
