import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@taiwanhub/shared";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
export interface ImageStorage {
  put(key: string, bytes: Uint8Array, mime: string): Promise<string>;
}
const local: ImageStorage = {
  async put(key, bytes) {
    if (process.env.NODE_ENV === "production")
      throw new AppError(
        503,
        "STORAGE_UNAVAILABLE",
        "Image uploads require production object storage. An HTTPS image URL can be used instead.",
      );
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, key), bytes);
    return "/uploads/" + key;
  },
};
const s3: ImageStorage = {
  async put(key, bytes, mime) {
    const bucket = process.env.IMAGE_STORAGE_BUCKET;
    const publicUrl = process.env.IMAGE_STORAGE_PUBLIC_URL;
    if (!bucket || !publicUrl)
      throw new AppError(
        503,
        "STORAGE_UNAVAILABLE",
        "Image storage is not configured.",
      );
    const client = new S3Client({
      region: process.env.IMAGE_STORAGE_REGION ?? "auto",
      endpoint: process.env.IMAGE_STORAGE_ENDPOINT,
      credentials:
        process.env.IMAGE_STORAGE_ACCESS_KEY_ID &&
        process.env.IMAGE_STORAGE_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.IMAGE_STORAGE_ACCESS_KEY_ID,
              secretAccessKey: process.env.IMAGE_STORAGE_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return publicUrl.replace(/\/$/, "") + "/" + key;
  },
};
export function imageStorage(): ImageStorage {
  return process.env.IMAGE_STORAGE_PROVIDER === "s3" ? s3 : local;
}
