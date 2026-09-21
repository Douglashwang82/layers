import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db, pool } from "./index";
import { generatedFeed } from "./schema";

const kindSchema = z.enum(["places", "events", "products", "organizations"]);
const organizationFieldsSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.string().url(),
  category: z.string().min(1),
});

async function extractOrganizationFields(html: string, client: Anthropic) {
  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content:
          "Extract facts about this organization from the HTML page below. " +
          "Only use facts stated on the page; never invent a value that is not present. " +
          "Respond with ONLY a JSON object with keys: name, description (1-2 sentences), " +
          "image (a full https image URL found on the page), category (one short label).\n\n" +
          `HTML:\n${html}`,
      },
    ],
  });
  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Agent response did not contain JSON.");
  return organizationFieldsSchema.parse(JSON.parse(jsonMatch[0]));
}

async function main() {
  const [, , slug, sourceUrl, kindArg, sourceLabel] = process.argv;
  if (!slug || !sourceUrl || !kindArg || !sourceLabel)
    throw new Error(
      "Usage: pnpm agent:run <slug> <sourceUrl> <kind> <sourceLabel>",
    );
  const kind = kindSchema.parse(kindArg);
  if (kind !== "organizations")
    throw new Error("This pilot agent only supports the organizations kind.");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required.");
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Fetching source failed: ${res.status}`);
  const html = await res.text();
  const client = new Anthropic({ apiKey });
  const fields = await extractOrganizationFields(html, client);
  const payload = {
    items: [{ id: `${slug}-1`, url: sourceUrl, fields }],
  };
  await db
    .insert(generatedFeed)
    .values({ slug, kind, sourceLabel, payload })
    .onConflictDoUpdate({
      target: generatedFeed.slug,
      set: { payload, sourceLabel, updatedAt: new Date() },
    });
  console.log(`Wrote feed "${slug}" with ${payload.items.length} item(s).`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
