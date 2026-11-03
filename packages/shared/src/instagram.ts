import { z } from "zod";

export function instagramPostUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["www.instagram.com", "instagram.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
  )
    throw new Error("Expected a public Instagram /p/ or /reel/ HTTPS URL.");
  return `https://www.instagram.com${url.pathname.replace(/\/$/, "")}/`;
}
export function isInstagramPost(value: string) {
  try {
    instagramPostUrl(value);
    return true;
  } catch {
    return false;
  }
}
export const instagramUrlSchema = z
  .string()
  .max(2048)
  .refine(isInstagramPost)
  .transform(instagramPostUrl);
export const restaurantsSchema = z
  .object({
    restaurants: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(200).nullable(),
            address: z.string().trim().min(1).max(500).nullable(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const instagramExtractionSchema = restaurantsSchema.extend({
  sourceUrl: instagramUrlSchema,
  potentiallyTruncated: z.boolean(),
});
export type InstagramExtraction = z.infer<typeof instagramExtractionSchema>;
