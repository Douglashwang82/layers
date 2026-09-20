import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./index";

export const ingestionKinds = [
  "places",
  "events",
  "products",
  "organizations",
] as const;
export type IngestionKind = (typeof ingestionKinds)[number];
const tables: Record<IngestionKind, string> = {
  places: "place",
  events: "event",
  products: "product",
  organizations: "organization",
};
const columns: Record<string, string> = {
  name: "name",
  nameChinese: "name_chinese",
  description: "description",
  descriptionChinese: "description_chinese",
  image: "image",
  category: "category",
  aliases: "aliases",
  website: "website",
  phone: "phone",
  hours: "hours",
  neighborhood: "neighborhood",
  address: "address",
  latitude: "latitude",
  longitude: "longitude",
  venue: "venue",
  startTime: "start_time",
  endTime: "end_time",
  organizerId: "organizer_id",
  externalUrl: "external_url",
  eventStatus: "event_status",
  brand: "brand",
  onlineUrl: "online_url",
  instagram: "instagram",
  facebook: "facebook",
};
const allowed: Record<IngestionKind, readonly string[]> = {
  places: [
    "name",
    "nameChinese",
    "description",
    "descriptionChinese",
    "image",
    "category",
    "aliases",
    "website",
    "phone",
    "hours",
    "neighborhood",
    "address",
    "latitude",
    "longitude",
  ],
  events: [
    "name",
    "nameChinese",
    "description",
    "descriptionChinese",
    "image",
    "category",
    "aliases",
    "neighborhood",
    "address",
    "latitude",
    "longitude",
    "venue",
    "startTime",
    "endTime",
    "organizerId",
    "externalUrl",
    "eventStatus",
  ],
  products: [
    "name",
    "nameChinese",
    "description",
    "descriptionChinese",
    "image",
    "category",
    "aliases",
    "brand",
    "onlineUrl",
  ],
  organizations: [
    "name",
    "nameChinese",
    "description",
    "descriptionChinese",
    "image",
    "category",
    "aliases",
    "website",
    "instagram",
    "facebook",
  ],
};
const required: Record<IngestionKind, readonly string[]> = {
  places: [
    "name",
    "description",
    "image",
    "category",
    "neighborhood",
    "address",
    "latitude",
    "longitude",
  ],
  events: [
    "name",
    "description",
    "image",
    "category",
    "neighborhood",
    "address",
    "latitude",
    "longitude",
    "venue",
    "startTime",
    "endTime",
    "organizerId",
  ],
  products: ["name", "description", "image", "category", "brand"],
  organizations: ["name", "description", "image", "category"],
};
const feed = z.object({
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(300),
        url: z.url({ protocol: /^https$/ }).max(2048),
        fields: z.record(z.string(), z.unknown()),
      }),
    )
    .max(500),
});
const urlFields = new Set([
  "image",
  "website",
  "externalUrl",
  "onlineUrl",
  "instagram",
  "facebook",
]);
const numericFields = new Set(["latitude", "longitude"]);
const dateFields = new Set(["startTime", "endTime"]);
const safeAutoFields = new Set([
  "nameChinese",
  "description",
  "descriptionChinese",
  "aliases",
  "website",
  "phone",
  "hours",
  "onlineUrl",
  "instagram",
  "facebook",
]);

export function validateFields(
  kind: IngestionKind,
  input: Record<string, unknown>,
) {
  const fields: Record<string, string | number> = {};
  const issues: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!allowed[kind].includes(key)) {
      issues.push(`Unknown field: ${key}`);
      continue;
    }
    if (numericFields.has(key)) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (key === "latitude" && Math.abs(value) > 90) ||
        (key === "longitude" && Math.abs(value) > 180)
      )
        issues.push(`Invalid ${key}`);
      else fields[key] = value;
    } else if (
      typeof value !== "string" ||
      value.length >
        (key === "description" || key === "descriptionChinese" ? 2000 : 2048) ||
      /[\u0000-\u0008<>]/.test(value)
    ) {
      issues.push(`Invalid ${key}`);
    } else if (
      urlFields.has(key) &&
      value &&
      !z.url({ protocol: /^https$/ }).safeParse(value).success
    ) {
      issues.push(`Invalid ${key} URL`);
    } else if (
      dateFields.has(key) &&
      !z.iso.datetime({ offset: true }).safeParse(value).success
    ) {
      issues.push(`Invalid ${key} timestamp`);
    } else if (
      key === "eventStatus" &&
      !["scheduled", "postponed", "cancelled"].includes(value)
    ) {
      issues.push("Invalid eventStatus");
    } else if (key === "organizerId" && !z.uuid().safeParse(value).success) {
      issues.push("Invalid organizerId");
    } else if (value.trim()) fields[key] = value.trim();
  }
  for (const key of required[kind])
    if (!fields[key]) issues.push(`Missing ${key}`);
  if (
    kind === "events" &&
    fields.startTime &&
    fields.endTime &&
    new Date(String(fields.endTime)) <= new Date(String(fields.startTime))
  )
    issues.push("Event end must follow start");
  return { fields, issues };
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function changedFields(
  fields: Record<string, string | number>,
  existing: Record<string, unknown>,
) {
  return Object.keys(fields).filter((key) => {
    const old = existing[columns[key]];
    return dateFields.has(key)
      ? (old instanceof Date ? old.getTime() : Date.parse(String(old))) !==
          Date.parse(String(fields[key]))
      : String(old ?? "") !== String(fields[key]);
  });
}
export function safeSlug(name: string, id: string) {
  return (
    (name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "listing") +
    "-" +
    id.slice(0, 8)
  );
}

function publicAddress(address: string) {
  const ip = isIP(address);
  if (ip === 4) {
    const n = address.split(".").map(Number);
    return (
      n[0] !== 0 &&
      n[0] !== 10 &&
      n[0] !== 127 &&
      n[0] !== 169 &&
      !(n[0] === 172 && n[1] >= 16 && n[1] <= 31) &&
      !(n[0] === 192 && n[1] === 168) &&
      n[0] < 224
    );
  }
  if (ip === 6) return !/^(::1$|::$|::ffff:|fe[89ab]|fc|fd|ff)/i.test(address);
  return false;
}
export async function validateSourceUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Source must use public HTTPS on port 443.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Source resolves to a private address.");
  return url;
}

type Source = {
  id: string;
  name: string;
  url: string;
  kind: IngestionKind;
  city_id: string | null;
  allow_auto_update: boolean;
};
type Match = { id: string; updated_at: Date } | "ambiguous" | null;
async function fetchSource(source: Source) {
  await validateSourceUrl(source.url);
  const response = await fetch(source.url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      accept: "application/json",
      "user-agent": "TaiwanHubContentCollector/1.0",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (
    !(response.headers.get("content-type") || "").includes("application/json")
  )
    throw new Error("Source is not a JSON feed.");
  if (Number(response.headers.get("content-length") || 0) > 1_000_000)
    throw new Error("Feed is too large.");
  const body = await response.text();
  if (body.length > 1_000_000) throw new Error("Feed is too large.");
  return feed.parse(JSON.parse(body)).items;
}

async function transaction<T>(fn: (tx: PoolClient) => Promise<T>) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const value = await fn(tx);
    await tx.query("COMMIT");
    return value;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

async function matchExisting(
  tx: PoolClient,
  source: Pick<Source, "kind" | "city_id">,
  fields: Record<string, string | number>,
): Promise<Match> {
  if (!fields.name) return null;
  const table = tables[source.kind];
  if (source.kind === "places" && fields.address && source.city_id) {
    const r = await tx.query<{ id: string; updated_at: Date }>(
      `SELECT id,updated_at FROM ${table} WHERE city_id=$1 AND lower(name)=lower($2) AND lower(address)=lower($3) AND is_demo=false AND status NOT IN ('hidden','deleted','rejected') LIMIT 2`,
      [source.city_id, fields.name, fields.address],
    );
    return r.rowCount === 1 ? r.rows[0] : r.rowCount ? "ambiguous" : null;
  }
  if (source.kind === "organizations" && source.city_id && fields.website) {
    const r = await tx.query<{ id: string; updated_at: Date }>(
      `SELECT id,updated_at FROM ${table} WHERE city_id=$1 AND website=$2 AND is_demo=false AND status NOT IN ('hidden','deleted','rejected') LIMIT 2`,
      [source.city_id, fields.website],
    );
    return r.rowCount === 1 ? r.rows[0] : r.rowCount ? "ambiguous" : null;
  }
  if (source.kind === "products" && fields.brand) {
    const r = await tx.query<{ id: string; updated_at: Date }>(
      `SELECT id,updated_at FROM ${table} WHERE lower(name)=lower($1) AND lower(brand)=lower($2) AND is_demo=false AND status NOT IN ('hidden','deleted','rejected') LIMIT 2`,
      [fields.name, fields.brand],
    );
    return r.rowCount === 1 ? r.rows[0] : r.rowCount ? "ambiguous" : null;
  }
  if (
    source.kind === "events" &&
    source.city_id &&
    fields.externalUrl &&
    fields.startTime
  ) {
    const r = await tx.query<{ id: string; updated_at: Date }>(
      `SELECT id,updated_at FROM ${table} WHERE city_id=$1 AND external_url=$2 AND start_time=$3 AND is_demo=false AND status NOT IN ('hidden','deleted','rejected') LIMIT 2`,
      [source.city_id, fields.externalUrl, fields.startTime],
    );
    return r.rowCount === 1 ? r.rows[0] : r.rowCount ? "ambiguous" : null;
  }
  return null;
}

async function collectOne(
  tx: PoolClient,
  source: Source,
  runId: string,
  item: z.infer<typeof feed>["items"][number],
) {
  const { fields, issues } = validateFields(source.kind, item.fields);
  if (source.kind !== "products" && !source.city_id)
    issues.push("Source needs a city");
  const hash = stableHash({ url: item.url, fields });
  const previous = await tx.query<{
    id: string;
    content_hash: string;
    entity_id: string | null;
  }>(
    `SELECT id,content_hash,entity_id FROM source_record WHERE source_id=$1 AND external_id=$2 FOR UPDATE`,
    [source.id, item.id],
  );
  const record = previous.rows[0];
  if (record?.content_hash === hash) {
    await tx.query("UPDATE source_record SET last_seen_at=now() WHERE id=$1", [
      record.id,
    ]);
    return "unchanged";
  }
  const recordId = record?.id ?? randomUUID();
  let entity = record?.entity_id
    ? (
        await tx.query<{ id: string; updated_at: Date }>(
          `SELECT id,updated_at FROM ${tables[source.kind]} WHERE id=$1 AND is_demo=false AND status NOT IN ('hidden','deleted','rejected')`,
          [record.entity_id],
        )
      ).rows[0]
    : null;
  if (record?.entity_id && !entity)
    issues.push("Linked content is unavailable");
  if (!entity && !record?.entity_id) {
    const match = await matchExisting(tx, source, fields);
    if (match === "ambiguous")
      issues.push(
        "Multiple existing records match; resolve the duplicate before publishing",
      );
    else entity = match;
  }
  if (source.kind === "events" && fields.organizerId) {
    const org = await tx.query(
      `SELECT 1 FROM organization WHERE id=$1 AND city_id=$2 AND status='approved'`,
      [fields.organizerId, source.city_id],
    );
    if (!org.rowCount)
      issues.push("Organizer must be approved in the same city");
  }
  if (record)
    await tx.query(
      `UPDATE source_record SET source_url=$1,content_hash=$2,last_seen_at=now(),updated_at=now() WHERE id=$3`,
      [item.url, hash, recordId],
    );
  else
    await tx.query(
      `INSERT INTO source_record(id,source_id,external_id,source_url,content_hash,entity_id) VALUES($1,$2,$3,$4,$5,$6)`,
      [recordId, source.id, item.id, item.url, hash, entity?.id ?? null],
    );
  await tx.query(
    `UPDATE content_candidate SET status='superseded',updated_at=now() WHERE source_record_id=$1 AND status='needs_review'`,
    [recordId],
  );
  const current = entity
    ? (
        await tx.query<Record<string, unknown>>(
          `SELECT * FROM ${tables[source.kind]} WHERE id=$1`,
          [entity.id],
        )
      ).rows[0]
    : null;
  const changed = current
    ? changedFields(fields, current)
    : Object.keys(fields);
  if (current && !changed.length && !issues.length) return "unchanged";
  const auto = Boolean(
    entity &&
    source.allow_auto_update &&
    !issues.length &&
    changed.every((key) => safeAutoFields.has(key)),
  );
  const candidate = await tx.query<{ id: string }>(
    `INSERT INTO content_candidate(source_record_id,run_id,kind,status,proposed,base_updated_at,issues) VALUES($1,$2,$3,'needs_review',$4,$5,$6) RETURNING id`,
    [
      recordId,
      runId,
      source.kind,
      JSON.stringify(fields),
      entity?.updated_at ?? null,
      JSON.stringify(issues),
    ],
  );
  if (auto) {
    try {
      await publishCandidate(tx, candidate.rows[0].id, null, false);
      return "published";
    } catch {
      /* A conflict belongs in review; the candidate stays available. */
    }
  }
  return "review";
}

export async function runCollection(
  options: { sourceId?: string; dryRun?: boolean } = {},
) {
  if (options.dryRun) {
    const sources = (
      await pool.query<Source>(
        "SELECT id,name,url,kind,city_id,allow_auto_update FROM content_source WHERE ($1::uuid IS NULL AND enabled=true) OR id=$1 ORDER BY id",
        [options.sourceId ?? null],
      )
    ).rows;
    const checks = [];
    for (const source of sources) {
      try {
        const items = await fetchSource(source);
        checks.push({
          source: source.name,
          items: items.length,
          invalid: items.filter(
            (item) => validateFields(source.kind, item.fields).issues.length,
          ).length,
        });
      } catch (error) {
        checks.push({ source: source.name, error: String(error) });
      }
    }
    return { dryRun: true, checks };
  }
  const lease = await pool.connect();
  const lock = await lease.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(74192026) AS locked",
  );
  if (!lock.rows[0].locked) {
    lease.release();
    throw new Error("A collection run is already active.");
  }
  const runId = randomUUID();
  const summary = {
    sources: 0,
    failed: 0,
    review: 0,
    published: 0,
    unchanged: 0,
    errors: [] as string[],
  };
  try {
    await pool.query("INSERT INTO ingestion_run(id) VALUES($1)", [runId]);
    const sources = (
      await pool.query<Source>(
        `SELECT id,name,url,kind,city_id,allow_auto_update FROM content_source WHERE enabled=true AND ($1::uuid IS NULL OR id=$1) AND ($1::uuid IS NOT NULL OR last_attempt_at IS NULL OR last_attempt_at < now()-interval_hours * interval '1 hour') ORDER BY CASE kind WHEN 'organizations' THEN 0 WHEN 'events' THEN 1 WHEN 'places' THEN 2 ELSE 3 END, id`,
        [options.sourceId ?? null],
      )
    ).rows;
    if (
      !sources.length &&
      !options.sourceId &&
      Number(
        (
          await pool.query<{ count: string }>(
            "SELECT count(*) AS count FROM content_source WHERE enabled=true",
          )
        ).rows[0].count,
      ) === 0
    )
      summary.errors.push("No approved sources are enabled.");
    for (const source of sources) {
      summary.sources++;
      await pool.query(
        "UPDATE content_source SET last_attempt_at=now() WHERE id=$1",
        [source.id],
      );
      try {
        const items = await fetchSource(source);
        for (const item of items) {
          try {
            const outcome = await transaction((tx) =>
              collectOne(tx, source, runId, item),
            );
            summary[outcome as "review" | "published" | "unchanged"]++;
          } catch (error) {
            summary.errors.push(
              `${source.name} / ${item.id}: ${String(error)}`,
            );
          }
        }
        await pool.query(
          "UPDATE content_source SET last_success_at=now(),consecutive_failures=0 WHERE id=$1",
          [source.id],
        );
      } catch (error) {
        summary.failed++;
        summary.errors.push(`${source.name}: ${String(error)}`);
        await pool.query(
          "UPDATE content_source SET consecutive_failures=consecutive_failures+1,enabled=CASE WHEN consecutive_failures>=4 THEN false ELSE enabled END WHERE id=$1",
          [source.id],
        );
      }
    }
    const stale = await pool.query<{ name: string }>(
      "SELECT name FROM content_source WHERE enabled=true AND (last_success_at IS NULL OR last_success_at < now()-interval '7 days')",
    );
    if (stale.rowCount)
      summary.errors.push(
        `Stale sources: ${stale.rows.map((r) => r.name).join(", ")}`,
      );
    await pool.query(
      "UPDATE ingestion_run SET finished_at=now(),status=$1,summary=$2 WHERE id=$3",
      [
        summary.errors.length ? "partial" : "complete",
        JSON.stringify(summary),
        runId,
      ],
    );
    return { runId, ...summary };
  } catch (error) {
    await pool.query(
      "UPDATE ingestion_run SET finished_at=now(),status='failed',summary=$1 WHERE id=$2",
      [JSON.stringify({ error: String(error) }), runId],
    );
    throw error;
  } finally {
    await lease.query("SELECT pg_advisory_unlock(74192026)");
    lease.release();
  }
}

export async function publishCandidate(
  tx: PoolClient,
  id: string,
  actorId: string | null,
  allowCreate: boolean,
) {
  const candidate = (
    await tx.query<{
      id: string;
      kind: IngestionKind;
      status: string;
      proposed: Record<string, string | number>;
      base_updated_at: Date | null;
      issues: string[];
      source_record_id: string;
      entity_id: string | null;
      city_id: string | null;
      source_url: string;
    }>(
      `SELECT c.*,r.entity_id,s.city_id,r.source_url FROM content_candidate c JOIN source_record r ON r.id=c.source_record_id JOIN content_source s ON s.id=r.source_id WHERE c.id=$1 FOR UPDATE OF c`,
      [id],
    )
  ).rows[0];
  if (!candidate || candidate.status !== "needs_review")
    throw new Error("Candidate is no longer available.");
  const { fields, issues } = validateFields(candidate.kind, candidate.proposed);
  if (issues.length || candidate.issues.length)
    throw new Error("Candidate has validation issues.");
  const table = tables[candidate.kind];
  let entityId = candidate.entity_id;
  const before = entityId
    ? (
        await tx.query<Record<string, unknown>>(
          `SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,
          [entityId],
        )
      ).rows[0]
    : null;
  if (
    entityId &&
    (!before ||
      before.is_demo ||
      ["hidden", "deleted", "rejected"].includes(String(before.status)))
  )
    throw new Error("Linked content is unavailable.");
  if (
    before &&
    candidate.base_updated_at &&
    (before.updated_at instanceof Date
      ? before.updated_at.getTime()
      : Date.parse(String(before.updated_at))) !==
      new Date(candidate.base_updated_at).getTime()
  )
    throw new Error("Content changed since this proposal was collected.");
  if (before) {
    const locks = (
      await tx.query<{ field: string }>(
        "SELECT field FROM content_field_lock WHERE kind=$1 AND entity_id=$2",
        [candidate.kind, entityId],
      )
    ).rows.map((r) => r.field);
    const keys = changedFields(fields, before);
    if (keys.some((key) => locks.includes(key)))
      throw new Error("A proposed field is locked by a moderator.");
    if (keys.length)
      await tx.query(
        `UPDATE ${table} SET ${keys.map((k, i) => `${columns[k]}=$${i + 2}`).join(",")},updated_at=now() WHERE id=$1`,
        [entityId, ...keys.map((k) => fields[k])],
      );
  } else {
    if (!allowCreate || !actorId)
      throw new Error("New content requires moderator approval.");
    if (candidate.kind !== "products" && !candidate.city_id)
      throw new Error("Source city is missing.");
    if (
      await matchExisting(
        tx,
        { kind: candidate.kind, city_id: candidate.city_id },
        fields,
      )
    )
      throw new Error(
        "A matching record now exists; reject this duplicate proposal.",
      );
    entityId = randomUUID();
    const values: Record<string, unknown> = {
      ...Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [columns[k], v]),
      ),
      id: entityId,
      slug: safeSlug(String(fields.name), entityId),
      source: candidate.source_url,
      status: "approved",
    };
    for (const key of ["name_chinese", "description_chinese", "aliases"])
      values[key] ??= "";
    if (candidate.kind !== "products") values.city_id = candidate.city_id;
    const keys = Object.keys(values);
    await tx.query(
      `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
      keys.map((key) => values[key]),
    );
  }
  if (candidate.kind === "places" || candidate.kind === "events")
    await tx.query(
      `UPDATE ${table} SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1`,
      [entityId],
    );
  const after = (
    await tx.query<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id=$1`,
      [entityId],
    )
  ).rows[0];
  await tx.query("UPDATE source_record SET entity_id=$1 WHERE id=$2", [
    entityId,
    candidate.source_record_id,
  ]);
  await tx.query(
    "INSERT INTO entity_source(source_record_id,kind,entity_id) VALUES($1,$2,$3) ON CONFLICT(source_record_id) DO UPDATE SET entity_id=$3,updated_at=now()",
    [candidate.source_record_id, candidate.kind, entityId],
  );
  await tx.query(
    "INSERT INTO content_revision(candidate_id,kind,entity_id,before,after,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      candidate.kind,
      entityId,
      JSON.stringify(before ?? {}),
      JSON.stringify(after),
      actorId,
    ],
  );
  await tx.query(
    "UPDATE content_candidate SET status='published',decided_by=$1,decided_at=now(),updated_at=now() WHERE id=$2",
    [actorId, id],
  );
  return { entityId };
}

export async function decideCandidate(
  id: string,
  actorId: string,
  decision: "approve" | "reject",
) {
  return transaction(async (tx) => {
    if (decision === "approve") return publishCandidate(tx, id, actorId, true);
    const result = await tx.query(
      "UPDATE content_candidate SET status='rejected',decided_by=$1,decided_at=now(),updated_at=now() WHERE id=$2 AND status='needs_review'",
      [actorId, id],
    );
    if (!result.rowCount) throw new Error("Candidate is no longer available.");
    return { status: "rejected" };
  });
}

export async function revertRevision(id: string, actorId: string) {
  return transaction(async (tx) => {
    const revision = (
      await tx.query<{
        kind: IngestionKind;
        entity_id: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      }>(
        "SELECT kind,entity_id,before,after FROM content_revision WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (
      !revision ||
      !ingestionKinds.includes(revision.kind) ||
      !revision.before.id
    )
      throw new Error("Only updates to existing content can be reverted here.");
    const table = tables[revision.kind];
    const current = (
      await tx.query<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,
        [revision.entity_id],
      )
    ).rows[0];
    if (
      !current ||
      (current.updated_at instanceof Date
        ? current.updated_at.getTime()
        : Date.parse(String(current.updated_at))) !==
        Date.parse(String(revision.after.updated_at))
    )
      throw new Error("Content has changed since this revision.");
    const keys = allowed[revision.kind].filter(
      (key) =>
        JSON.stringify(revision.before[columns[key]]) !==
        JSON.stringify(revision.after[columns[key]]),
    );
    if (!keys.length)
      throw new Error("There are no editable fields to revert.");
    await tx.query(
      `UPDATE ${table} SET ${keys.map((key, i) => `${columns[key]}=$${i + 2}`).join(",")},updated_at=now() WHERE id=$1`,
      [revision.entity_id, ...keys.map((key) => revision.before[columns[key]])],
    );
    if (
      (revision.kind === "places" || revision.kind === "events") &&
      (keys.includes("latitude") || keys.includes("longitude"))
    )
      await tx.query(
        `UPDATE ${table} SET location=ST_SetSRID(ST_MakePoint(longitude,latitude),4326) WHERE id=$1`,
        [revision.entity_id],
      );
    const after = (
      await tx.query<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE id=$1`,
        [revision.entity_id],
      )
    ).rows[0];
    await tx.query(
      "INSERT INTO content_revision(kind,entity_id,before,after,actor_id) VALUES($1,$2,$3,$4,$5)",
      [
        revision.kind,
        revision.entity_id,
        JSON.stringify(current),
        JSON.stringify(after),
        actorId,
      ],
    );
    return { entityId: revision.entity_id };
  });
}
