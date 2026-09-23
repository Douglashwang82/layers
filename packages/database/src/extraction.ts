import { z } from "zod";
import { pool } from "./index";
import { validateSourceUrl } from "./ingestion";

/**
 * Source pages for the extraction adapter. These live in the database rather
 * than a checked-in list so an administrator can add, pause and remove them
 * from /admin/extraction without a deploy, and so each run can report back what
 * happened to every page.
 */
export const extractionKinds = ["places", "organizations"] as const;
export type ExtractionKind = (typeof extractionKinds)[number];

export type ExtractionPage = {
  id: string;
  feed_slug: string;
  kind: ExtractionKind;
  source_label: string;
  url: string;
  neighborhood: string;
  permission_note: string;
  enabled: boolean;
  last_run_at: Date | null;
  last_status: string;
};

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use a lowercase-with-hyphens slug.");

export const extractionPageInput = z.object({
  feedSlug: slug,
  kind: z.enum(extractionKinds),
  sourceLabel: z.string().trim().min(1).max(120),
  url: z.url({ protocol: /^https$/ }).max(2048),
  neighborhood: z.string().trim().max(120).default(""),
  // Mirrors the permission_note gate on content_source: a page may not be
  // collected until someone has recorded why it is allowed.
  permissionNote: z.string().trim().min(10).max(1000),
});

const columns =
  "id,feed_slug,kind,source_label,url,neighborhood,permission_note,enabled,last_run_at,last_status";

export async function listExtractionPages() {
  return (
    await pool.query<ExtractionPage>(
      `SELECT ${columns} FROM extraction_page ORDER BY feed_slug, created_at`,
    )
  ).rows;
}

/** Enabled pages for one feed, or for every feed that has any. */
export async function enabledExtractionPages(feedSlug?: string) {
  return (
    await pool.query<ExtractionPage>(
      `SELECT ${columns} FROM extraction_page WHERE enabled=true AND ($1::text IS NULL OR feed_slug=$1) ORDER BY feed_slug, created_at`,
      [feedSlug ?? null],
    )
  ).rows;
}

export async function addExtractionPage(input: unknown, actorId: string) {
  const value = extractionPageInput.parse(input);
  // Same check the worker applies to a feed URL: public HTTPS, no private host.
  const url = (await validateSourceUrl(value.url)).toString();
  const existing = await pool.query(
    "SELECT id FROM extraction_page WHERE url=$1",
    [url],
  );
  if (existing.rowCount) throw new Error("That page is already listed.");
  const conflicting = await pool.query<{ kind: string; source_label: string }>(
    "SELECT kind,source_label FROM extraction_page WHERE feed_slug=$1 LIMIT 1",
    [value.feedSlug],
  );
  const first = conflicting.rows[0];
  if (
    first &&
    (first.kind !== value.kind || first.source_label !== value.sourceLabel)
  )
    throw new Error(
      `Feed "${value.feedSlug}" already collects ${first.kind} as "${first.source_label}".`,
    );
  return (
    await pool.query<{ id: string }>(
      "INSERT INTO extraction_page(feed_slug,kind,source_label,url,neighborhood,permission_note,added_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [
        value.feedSlug,
        value.kind,
        value.sourceLabel,
        url,
        value.neighborhood,
        value.permissionNote,
        actorId,
      ],
    )
  ).rows[0];
}

export async function setExtractionPageEnabled(id: string, enabled: boolean) {
  const result = await pool.query(
    "UPDATE extraction_page SET enabled=$1,updated_at=now() WHERE id=$2",
    [enabled, z.uuid().parse(id)],
  );
  if (!result.rowCount) throw new Error("Page not found.");
  return { enabled };
}

export async function removeExtractionPage(id: string) {
  const result = await pool.query("DELETE FROM extraction_page WHERE id=$1", [
    z.uuid().parse(id),
  ]);
  if (!result.rowCount) throw new Error("Page not found.");
  return { removed: true };
}

/** Records what a run did with a page so the interface can show it. */
export async function recordExtractionResult(id: string, status: string) {
  await pool.query(
    "UPDATE extraction_page SET last_run_at=now(),last_status=$1,updated_at=now() WHERE id=$2",
    [status.slice(0, 500), id],
  );
}
