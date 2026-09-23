import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../packages/database/src";
import {
  addExtractionPage,
  enabledExtractionPages,
  recordExtractionResult,
  removeExtractionPage,
  setExtractionPageEnabled,
} from "../../packages/database/src/extraction";

const actor = crypto.randomUUID();
const slug = `probe-${actor.slice(0, 8)}`;
const base = {
  feedSlug: slug,
  kind: "places" as const,
  sourceLabel: "Probe places",
  permissionNote: "Owner granted reuse of stated facts; reviewed 2026-09-23.",
};
let pageId: string;
beforeAll(async () => {
  await pool.query(
    "INSERT INTO \"user\"(id,name,email,role) VALUES($1,$2,$3,'ADMIN')",
    [actor, "Extraction Test", actor + "@example.test"],
  );
});
afterAll(async () => {
  await pool.query("DELETE FROM extraction_page WHERE feed_slug=$1", [slug]);
  await pool.query('DELETE FROM "user" WHERE id=$1', [actor]);
  await pool.end();
});
describe("extraction source pages", () => {
  it("adds a page paused and only collects it once enabled", async () => {
    pageId = (
      await addExtractionPage(
        { ...base, url: "https://example.org/probe-bakery" },
        actor,
      )
    ).id;
    // A new page must never be collected by the next scheduled run.
    expect(await enabledExtractionPages(slug)).toEqual([]);
    await setExtractionPageEnabled(pageId, true);
    const enabled = await enabledExtractionPages(slug);
    expect(enabled.map((p) => p.url)).toEqual([
      "https://example.org/probe-bakery",
    ]);
    expect(enabled[0].source_label).toBe("Probe places");
  });
  it("refuses a duplicate URL and a feed with mismatched kind", async () => {
    await expect(
      addExtractionPage(
        { ...base, url: "https://example.org/probe-bakery" },
        actor,
      ),
    ).rejects.toThrow("already listed");
    await expect(
      addExtractionPage(
        {
          ...base,
          kind: "organizations",
          url: "https://example.org/probe-other",
        },
        actor,
      ),
    ).rejects.toThrow("already collects places");
  });
  it("requires a permission note and a public HTTPS page", async () => {
    await expect(
      addExtractionPage(
        { ...base, url: "https://example.org/probe-2", permissionNote: "n/a" },
        actor,
      ),
    ).rejects.toThrow();
    await expect(
      addExtractionPage({ ...base, url: "http://example.org/probe-3" }, actor),
    ).rejects.toThrow();
    await expect(
      addExtractionPage({ ...base, url: "https://localhost/probe-4" }, actor),
    ).rejects.toThrow();
  });
  it("carries a run result back for the interface", async () => {
    await recordExtractionResult(pageId, "Geocoder found no match");
    const [page] = await enabledExtractionPages(slug);
    expect(page.last_status).toBe("Geocoder found no match");
    expect(page.last_run_at).toBeInstanceOf(Date);
    expect(await removeExtractionPage(pageId)).toEqual({ removed: true });
    expect(await enabledExtractionPages(slug)).toEqual([]);
  });
});
