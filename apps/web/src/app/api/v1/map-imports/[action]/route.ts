import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@taiwanhub/database";
import { AppError } from "@taiwanhub/shared";
import { maxImportBytes } from "@taiwanhub/shared/map-import";
import { currentActor } from "@/lib/session";
import { appUrl } from "@/lib/config";
import {
  commitMapImport,
  importActor,
  reviewMapImport,
} from "@/features/map-import/service";
import { decodeMap, parseKml } from "@/features/map-import/parser";
import { downloadMap } from "@/features/map-import/download";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const actor = importActor(await currentActor());
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(appUrl).origin)
      throw new AppError(403, "BAD_ORIGIN", "Request origin is not allowed.");
    const { action } = await params;
    if (!["preview", "review", "commit"].includes(action))
      throw new AppError(404, "NOT_FOUND", "Unknown import action.");
    const budget = await pool.query<{ count: number }>(
      `INSERT INTO rate_limit(key,count,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limit.expires_at<now() THEN 1 ELSE rate_limit.count+1 END,expires_at=CASE WHEN rate_limit.expires_at<now() THEN now()+interval '1 minute' ELSE rate_limit.expires_at END RETURNING count`,
      [`map_import:${actor.id}`],
    );
    if (budget.rows[0].count > 10)
      throw new AppError(
        429,
        "RATE_LIMITED",
        "Please wait a minute before importing again.",
      );
    const reader = request.body?.getReader();
    if (!reader) throw new AppError(400, "INVALID_BODY", "Choose a map.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxImportBytes * 1.4) {
          await reader.cancel();
          throw new AppError(413, "TOO_LARGE", "Map exceeds 5 MB.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    let data: unknown;
    if (action === "commit") data = await commitMapImport(actor, body);
    else if (action === "review") data = await reviewMapImport(actor, body);
    else {
      const input = z
        .union([
          z.object({ url: z.string().max(4096) }),
          z.object({
            file: z
              .string()
              .max(Math.ceil(maxImportBytes * 1.34))
              .regex(/^[A-Za-z0-9+/]*={0,2}$/),
          }),
        ])
        .parse(body);
      const source =
        "url" in input
          ? await downloadMap(input.url)
          : { bytes: Buffer.from(input.file, "base64"), sourceUrl: "" };
      data = parseKml(decodeMap(source.bytes), source.sourceUrl);
    }
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 502;
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues.map((i) => i.message).join(" ")
          : "Could not read this map. Try uploading its KML/KMZ export.";
    return NextResponse.json(
      {
        error: {
          code: error instanceof AppError ? error.code : "IMPORT_FAILED",
          message,
        },
      },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
