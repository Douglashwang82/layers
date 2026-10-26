import { parseArgs } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { extractRestaurants, instagramPostUrl } from "./instagram-caption";
import { readInstagramCaption } from "./instagram-caption-browser";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: "string" },
      "caption-file": { type: "string" },
      headed: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "pnpm instagram:extract <instagram-url> --model <installed-local-model> [--headed] [--caption-file <utf8-file>]",
    );
    return;
  }
  if (positionals.length !== 1 || !values.model)
    throw new Error(
      "Provide one Instagram URL and --model. Run with --help for usage.",
    );
  const sourceUrl = instagramPostUrl(positionals[0]);
  let input;
  if (values["caption-file"]) {
    if ((await stat(values["caption-file"])).size > 48000)
      throw new Error("Caption file too large.");
    input = {
      sourceUrl,
      caption: await readFile(values["caption-file"], "utf8"),
      captionSource: "user-file",
      potentiallyTruncated: false,
    };
  } else input = await readInstagramCaption(sourceUrl, values.headed);
  const result = await extractRestaurants(input.caption, values.model);
  console.log(
    JSON.stringify({ ...input, ...result, needsReview: true }, null, 2),
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Extraction failed.");
  process.exitCode = 1;
});
