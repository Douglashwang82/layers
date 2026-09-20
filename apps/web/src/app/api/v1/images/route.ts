import { NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/session";
import { AppError, requireActor } from "@taiwanhub/shared";
import { contributionLimit } from "@/features/community/service";
import { imageStorage } from "@/lib/storage";
import { appUrl } from "@/lib/config";
import { db, schema } from "@taiwanhub/database";
export async function POST(req: NextRequest) {
  try {
    const actor = requireActor(await currentActor());
    if (req.headers.get("origin") !== new URL(appUrl).origin)
      throw new AppError(403, "ORIGIN", "Invalid origin.");
    await contributionLimit(actor);
    if (Number(req.headers.get("content-length") ?? 0) > 5_300_000)
      throw new AppError(413, "SIZE", "Maximum image size is 5 MB.");
    const data = await req.formData();
    const file = data.get("image");
    if (!(file instanceof File) || file.size > 5_000_000)
      throw new AppError(400, "IMAGE", "Choose an image under 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png =
      bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp =
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
    if (!png && !jpg && !webp)
      throw new AppError(400, "IMAGE", "Use PNG, JPEG or WebP.");
    const extension = png ? "png" : jpg ? "jpg" : "webp";
    const key = crypto.randomUUID() + "." + extension;
    const url = await imageStorage().put(key, bytes, file.type);
    await db.insert(schema.image).values({
      key,
      url,
      userId: actor.id,
      mimeType: png ? "image/png" : jpg ? "image/jpeg" : "image/webp",
    });
    return NextResponse.json({ data: { url } }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          message: e instanceof AppError ? e.message : "Upload failed.",
        },
      },
      { status: e instanceof AppError ? e.status : 500 },
    );
  }
}
