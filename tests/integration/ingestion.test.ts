import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";
import {
  decideCandidate,
  revertRevision,
} from "../../packages/database/src/ingestion";
import { getContent } from "../../apps/web/src/features/catalog/repository";

const actor = crypto.randomUUID(),
  source = crypto.randomUUID(),
  run = crypto.randomUUID(),
  record = crypto.randomUUID(),
  candidate = crypto.randomUUID();
const update = crypto.randomUUID();
const demoSource = crypto.randomUUID(),
  demoRecord = crypto.randomUUID(),
  demoCandidate = crypto.randomUUID();
let demoEntityId: string;
const city = "00000000-0000-4000-8000-000000001001";
const proposed = {
  name: "Integration Organization",
  description: "A Houston community group.",
  image: "https://example.org/organization.png",
  category: "Culture",
  website: "https://example.org",
};
let entityId: string;
beforeAll(async () => {
  await pool.query(
    "INSERT INTO \"user\"(id,name,email,role) VALUES($1,$2,$3,'MODERATOR')",
    [actor, "Ingestion Test", actor + "@example.test"],
  );
  await pool.query(
    "INSERT INTO content_source(id,name,url,kind,city_id,enabled) VALUES($1,'Test source',$2,'organizations',$3,false)",
    [source, `https://example.org/${source}.json`, city],
  );
  await pool.query("INSERT INTO ingestion_run(id) VALUES($1)", [run]);
  await pool.query(
    "INSERT INTO source_record(id,source_id,external_id,source_url,content_hash) VALUES($1,$2,'group',$3,'hash')",
    [record, source, "https://example.org/group"],
  );
  await pool.query(
    "INSERT INTO content_candidate(id,source_record_id,run_id,kind,proposed) VALUES($1,$2,$3,'organizations',$4)",
    [candidate, record, run, JSON.stringify(proposed)],
  );
  await pool.query(
    "INSERT INTO content_source(id,name,url,kind,city_id,enabled,is_demo) VALUES($1,'Demo source',$2,'organizations',$3,false,true)",
    [demoSource, `https://example.org/${demoSource}.json`, city],
  );
  await pool.query(
    "INSERT INTO source_record(id,source_id,external_id,source_url,content_hash) VALUES($1,$2,'demo-group',$3,'demo-hash')",
    [demoRecord, demoSource, "https://example.org/demo-group"],
  );
  await pool.query(
    "INSERT INTO content_candidate(id,source_record_id,run_id,kind,proposed) VALUES($1,$2,$3,'organizations',$4)",
    [
      demoCandidate,
      demoRecord,
      run,
      JSON.stringify({ ...proposed, name: "Demo Integration Organization" }),
    ],
  );
});
afterAll(async () => {
  await pool.query("DELETE FROM entity_source WHERE source_record_id=$1", [
    demoRecord,
  ]);
  await pool.query("DELETE FROM content_revision WHERE entity_id=$1", [
    demoEntityId,
  ]);
  await pool.query("DELETE FROM content_candidate WHERE source_record_id=$1", [
    demoRecord,
  ]);
  await pool.query("DELETE FROM source_record WHERE id=$1", [demoRecord]);
  await pool.query("DELETE FROM content_source WHERE id=$1", [demoSource]);
  await pool.query("DELETE FROM organization WHERE id=$1", [demoEntityId]);
  await pool.query("DELETE FROM content_field_lock WHERE entity_id=$1", [
    entityId,
  ]);
  await pool.query("DELETE FROM content_revision WHERE entity_id=$1", [
    entityId,
  ]);
  await pool.query("DELETE FROM entity_source WHERE source_record_id=$1", [
    record,
  ]);
  await pool.query("DELETE FROM content_candidate WHERE source_record_id=$1", [
    record,
  ]);
  await pool.query("DELETE FROM source_record WHERE id=$1", [record]);
  await pool.query("DELETE FROM content_source WHERE id=$1", [source]);
  await pool.query("DELETE FROM ingestion_run WHERE id=$1", [run]);
  await pool.query("DELETE FROM organization WHERE id=$1", [entityId]);
  await pool.query('DELETE FROM "user" WHERE id=$1', [actor]);
  await pool.end();
});
describe("ingestion publishing", () => {
  it("publishes a reviewed listing once and records its source", async () => {
    entityId = (
      (await decideCandidate(candidate, actor, "approve")) as {
        entityId: string;
      }
    ).entityId;
    const result = await pool.query(
      "SELECT status,is_demo,source FROM organization WHERE id=$1",
      [entityId],
    );
    expect(result.rows[0]).toMatchObject({
      status: "approved",
      is_demo: false,
      source: "https://example.org/group",
    });
    expect(
      (
        await pool.query(
          "SELECT entity_id FROM entity_source WHERE source_record_id=$1",
          [record],
        )
      ).rows[0].entity_id,
    ).toBe(entityId);
    expect((await getContent("organizations", entityId)).sourceLinks).toEqual([
      { label: "Test source", url: "https://example.org/group" },
    ]);
    await expect(decideCandidate(candidate, actor, "approve")).rejects.toThrow(
      "no longer available",
    );
  });
  it("marks a listing from a demo source as demo", async () => {
    demoEntityId = (
      (await decideCandidate(demoCandidate, actor, "approve")) as {
        entityId: string;
      }
    ).entityId;
    expect(
      (
        await pool.query("SELECT is_demo FROM organization WHERE id=$1", [
          demoEntityId,
        ])
      ).rows[0].is_demo,
    ).toBe(true);
  });
  it("blocks a moderator-locked field", async () => {
    const base = (
      await pool.query<{ updated_at: Date }>(
        "SELECT updated_at FROM organization WHERE id=$1",
        [entityId],
      )
    ).rows[0].updated_at;
    await pool.query(
      "INSERT INTO content_field_lock(kind,entity_id,field,actor_id) VALUES('organizations',$1,'description',$2)",
      [entityId, actor],
    );
    await pool.query(
      "INSERT INTO content_candidate(id,source_record_id,run_id,kind,proposed,base_updated_at) VALUES($1,$2,$3,'organizations',$4,$5)",
      [
        update,
        record,
        run,
        JSON.stringify({ ...proposed, description: "Changed by feed" }),
        base,
      ],
    );
    await expect(decideCandidate(update, actor, "approve")).rejects.toThrow(
      "locked",
    );
    expect(
      (
        await pool.query("SELECT description FROM organization WHERE id=$1", [
          entityId,
        ])
      ).rows[0].description,
    ).toBe(proposed.description);
  });
  it("records and safely reverts an approved update", async () => {
    await pool.query("DELETE FROM content_field_lock WHERE entity_id=$1", [
      entityId,
    ]);
    await decideCandidate(update, actor, "approve");
    expect(
      (
        await pool.query("SELECT description FROM organization WHERE id=$1", [
          entityId,
        ])
      ).rows[0].description,
    ).toBe("Changed by feed");
    const revision = (
      await pool.query<{ id: string }>(
        "SELECT id FROM content_revision WHERE candidate_id=$1",
        [update],
      )
    ).rows[0].id;
    await revertRevision(revision, actor);
    expect(
      (
        await pool.query("SELECT description FROM organization WHERE id=$1", [
          entityId,
        ])
      ).rows[0].description,
    ).toBe(proposed.description);
    await expect(revertRevision(revision, actor)).rejects.toThrow(
      "changed since this revision",
    );
  });
});
