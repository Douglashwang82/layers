import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  instagramUrlSchema,
  instagramExtractionSchema,
  type InstagramExtraction,
} from "../../shared/src/instagram";

/** Worker has no database credentials or Google key dependency. One extraction
 * at a time, no queue and no caching of captions or personal browser state. */
export function createInstagramWorker(
  token: string,
  extract: (url: string) => Promise<InstagramExtraction>,
) {
  if (token.length < 32)
    throw new Error(
      "INSTAGRAM_WORKER_TOKEN must contain at least 32 characters.",
    );
  let busy = false;
  const expected = Buffer.from(`Bearer ${token}`);
  return createServer(
    { requestTimeout: 10000, headersTimeout: 10000 },
    async (req, res) => {
      const send = (status: number, data: unknown) => {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(data));
      };
      const actual = Buffer.from(req.headers.authorization ?? "");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        send(401, { error: "unauthorized" });
        req.resume();
        return;
      }
      if (req.url !== "/extract" || req.method !== "POST") {
        send(404, { error: "not_found" });
        req.resume();
        return;
      }
      if (busy) {
        send(429, { error: "busy" });
        req.resume();
        return;
      }
      busy = true;
      try {
        let body = "",
          bytes = 0;
        req.setEncoding("utf8");
        for await (const chunk of req) {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 4096) {
            send(413, { error: "body_too_large" });
            return;
          }
          body += chunk;
        }
        const input = z
          .object({ url: instagramUrlSchema })
          .strict()
          .safeParse(JSON.parse(body));
        if (!input.success) {
          send(400, { error: "invalid_url" });
          return;
        }
        const result = instagramExtractionSchema.parse(
          await extract(input.data.url),
        );
        if (result.sourceUrl !== input.data.url)
          throw new Error("Mismatched source");
        send(200, result);
      } catch {
        send(422, { error: "extraction_failed" });
      } finally {
        busy = false;
      }
    },
  );
}
