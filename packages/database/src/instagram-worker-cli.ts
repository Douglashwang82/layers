import "dotenv/config";
import { createInstagramWorker } from "./instagram-worker";
import { extractRestaurants } from "./instagram-caption";
import { readInstagramCaption } from "./instagram-caption-browser";

const model = process.env.INSTAGRAM_OLLAMA_MODEL;
const token = process.env.INSTAGRAM_WORKER_TOKEN ?? "";
if (!model || model.toLowerCase().includes("cloud"))
  throw new Error("Set INSTAGRAM_OLLAMA_MODEL to an installed local model.");
const server = createInstagramWorker(token, async (url) => {
  const input = await readInstagramCaption(url);
  const result = await extractRestaurants(input.caption, model);
  return {
    sourceUrl: input.sourceUrl,
    potentiallyTruncated: input.potentiallyTruncated,
    ...result,
  };
});
server.listen(11435, "127.0.0.1", () =>
  console.log("Instagram worker listening on 127.0.0.1:11435"),
);
server.on("error", () => {
  console.error("Instagram worker could not listen on port 11435.");
  process.exitCode = 1;
});
