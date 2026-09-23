import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db, pool } from "./index";
import { generatedFeed } from "./schema";
import { validateFields } from "./ingestion";
import {
  enabledExtractionPages,
  recordExtractionResult,
  type ExtractionKind,
  type ExtractionPage,
} from "./extraction";
import { placeCategories } from "../../shared/src";

/**
 * Feed adapter. Fetches operator-approved pages, has a model extract only facts
 * stated on each page, resolves coordinates with a real geocoder, validates the
 * result against the feed contract, and stores it for /api/feeds/<slug>.
 *
 * The model never supplies coordinates: a recalled latitude looks plausible and
 * lands the pin on the wrong block. Addresses come from the page, coordinates
 * from the US Census geocoder, and anything the page does not state is omitted
 * so the candidate fails validation here rather than reaching a moderator as an
 * unverifiable claim.
 */
const organizationFieldsSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.string().url(),
  category: z.string().min(1),
});
const placeFieldsSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(placeCategories),
  address: z.string().min(1),
  neighborhood: z.string().default(""),
  website: z.string().default(""),
  phone: z.string().default(""),
});

const model = "claude-sonnet-5";
const maxHtml = 60_000;

/** Drops non-content markup so a long page still fits one extraction call. */
function readableHtml(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, maxHtml);
}

function jsonFrom(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Agent response did not contain JSON.");
  return JSON.parse(match[0]) as unknown;
}

async function ask(client: Anthropic, prompt: string) {
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content.find((b) => b.type === "text")?.text ?? "";
}

async function extractOrganizationFields(html: string, client: Anthropic) {
  return organizationFieldsSchema.parse(
    jsonFrom(
      await ask(
        client,
        "Extract facts about this organization from the HTML page below. " +
          "Only use facts stated on the page; never invent a value that is not present. " +
          "Respond with ONLY a JSON object with keys: name, description (1-2 sentences), " +
          "image (a full https image URL found on the page), category (one short label).\n\n" +
          `HTML:\n${html}`,
      ),
    ),
  );
}

async function extractPlaceFields(html: string, client: Anthropic) {
  return placeFieldsSchema.parse(
    jsonFrom(
      await ask(
        client,
        "Extract facts about this business or venue from the HTML page below. " +
          "Only use facts stated on the page; never invent a value that is not present. " +
          "Use an empty string for anything the page does not state. " +
          "Do NOT provide coordinates, latitude, or longitude under any circumstances.\n\n" +
          "Respond with ONLY a JSON object with these keys:\n" +
          "- name: the business name as written on the page\n" +
          "- description: 1-2 sentences describing it, drawn only from the page\n" +
          `- category: exactly one of ${placeCategories.join(", ")}\n` +
          "- address: the full street address as written on the page\n" +
          "- neighborhood: only if the page names one, else an empty string\n" +
          "- website: the business's own https URL if stated, else an empty string\n" +
          "- phone: the phone number if stated, else an empty string\n\n" +
          `HTML:\n${html}`,
      ),
    ),
  );
}

/**
 * US Census geocoder: free, keyless, public domain, US addresses, and no
 * restriction on storing what it returns. Mapbox needs the permanent-geocoding
 * endpoint and the matching plan before results may be kept.
 */
async function geocode(address: string) {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(address)}` +
    "&benchmark=Public_AR_Current&format=json";
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok)
    throw new Error(`Geocoder returned HTTP ${response.status}`);
  const data = (await response.json()) as {
    result?: {
      addressMatches?: {
        matchedAddress?: string;
        coordinates?: { x?: number; y?: number };
      }[];
    };
  };
  const match = data.result?.addressMatches?.[0];
  const latitude = match?.coordinates?.y;
  const longitude = match?.coordinates?.x;
  if (typeof latitude !== "number" || typeof longitude !== "number")
    throw new Error(`Geocoder found no match for "${address}"`);
  return { latitude, longitude, matchedAddress: match?.matchedAddress ?? "" };
}

async function fetchPage(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "user-agent": "TaiwanHubContentCollector/1.0" },
  });
  if (!response.ok)
    throw new Error(`Fetching source failed: ${response.status}`);
  return readableHtml(await response.text());
}

/** Stable across runs and independent of the order URLs are passed. */
const itemId = (url: string) =>
  createHash("sha256").update(url).digest("hex").slice(0, 16);

const https = (value: string) => (value.startsWith("https://") ? value : "");

async function buildItem(
  kind: ExtractionKind,
  url: string,
  client: Anthropic,
  neighborhoodFallback: string,
) {
  const html = await fetchPage(url);
  if (kind === "organizations")
    return {
      id: itemId(url),
      url,
      fields: await extractOrganizationFields(html, client),
    };
  const extracted = await extractPlaceFields(html, client);
  const { latitude, longitude, matchedAddress } = await geocode(
    extracted.address,
  );
  if (matchedAddress) console.log(`  geocoded to ${matchedAddress}`);
  const neighborhood = extracted.neighborhood || neighborhoodFallback;
  return {
    id: itemId(url),
    url,
    fields: {
      name: extracted.name,
      description: extracted.description,
      category: extracted.category,
      address: extracted.address,
      neighborhood,
      latitude,
      longitude,
      ...(https(extracted.website) ? { website: extracted.website } : {}),
      ...(extracted.phone ? { phone: extracted.phone } : {}),
    },
  };
}

/** Collects one feed's enabled pages and stores the result. */
async function buildFeed(pages: ExtractionPage[], client: Anthropic) {
  const { feed_slug: slug, kind, source_label: sourceLabel } = pages[0];
  const items = [];
  let failed = 0;
  for (const page of pages) {
    console.log(`Reading ${page.url}`);
    try {
      const item = await buildItem(kind, page.url, client, page.neighborhood);
      const { issues } = validateFields(kind, item.fields);
      if (issues.length) throw new Error(issues.join("; "));
      items.push(item);
      console.log(`  ok: ${String(item.fields.name)}`);
      await recordExtractionResult(page.id, `ok: ${String(item.fields.name)}`);
    } catch (error) {
      failed++;
      console.error(`  skipped ${page.url}: ${String(error)}`);
      await recordExtractionResult(page.id, String(error));
    }
  }
  if (!items.length) {
    console.error(`No page produced a valid item; "${slug}" left unchanged.`);
    return { slug, items: 0, failed };
  }
  const payload = { items };
  await db
    .insert(generatedFeed)
    .values({ slug, kind, sourceLabel, payload })
    .onConflictDoUpdate({
      target: generatedFeed.slug,
      set: { payload, sourceLabel, updatedAt: new Date() },
    });
  console.log(`Wrote feed "${slug}" with ${items.length} item(s).`);
  return { slug, items: items.length, failed };
}

async function main() {
  const [feedSlug] = process.argv.slice(2);
  // Pages come from the extraction_page table, managed at /admin/extraction.
  const pages = await enabledExtractionPages(feedSlug);
  if (!pages.length) {
    console.log(
      feedSlug
        ? `No enabled pages for feed "${feedSlug}"; nothing to collect.`
        : "No enabled extraction pages; nothing to collect.",
    );
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required.");
  const client = new Anthropic({ apiKey });

  const feeds = new Map<string, ExtractionPage[]>();
  for (const page of pages)
    feeds.set(page.feed_slug, [...(feeds.get(page.feed_slug) ?? []), page]);
  let failed = 0;
  for (const group of feeds.values())
    failed += (await buildFeed(group, client)).failed;
  console.log(
    `Collected ${feeds.size} feed(s) from ${pages.length} page(s)` +
      `${failed ? `, ${failed} skipped` : ""}.`,
  );
  // A skipped page is an operator problem: surface it as a failed run.
  if (failed) process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
