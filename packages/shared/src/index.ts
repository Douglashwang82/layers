import { z } from "zod";
export const placeCategories = [
  "Taiwanese",
  "Bubble Tea",
  "Bakery",
  "Hot Pot",
  "Breakfast",
  "Dessert",
  "Asian Grocery",
  "Japanese",
  "Korean",
  "Chinese",
  "Cafe",
  "Other",
] as const;
export const eventCategories = [
  "Food",
  "Sports",
  "Social",
  "Networking",
  "Culture",
  "Festival",
  "Student",
  "Family",
  "Outdoor",
  "Professional",
  "Other",
] as const;
export const kinds = ["places", "events", "products", "organizations"] as const;
export type Kind = (typeof kinds)[number];
export type Role = "USER" | "MODERATOR" | "ADMIN";
export type Actor = { id: string; role: Role };
export const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !/[<>\u0000-\u0008]/.test(v),
      "Use plain text without markup.",
    );
export const imageUrl = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(v) ||
      /^\/demo\/product-\d+\.svg$/.test(v) ||
      z.url({ protocol: /^https$/ }).safeParse(v).success,
    "Use an HTTPS image URL or an uploaded image.",
  );
export const recommendationInput = z.object({
  positive: z.boolean(),
  note: plainText(300).optional(),
});
export const sightingInput = z.object({
  productId: z.uuid(),
  placeId: z.uuid(),
  price: z.number().min(0).max(10000).optional(),
  image: imageUrl.optional(),
  observedAt: z.iso
    .datetime()
    .refine(
      (v) => new Date(v).getTime() <= Date.now(),
      "Date cannot be in the future.",
    ),
});
const baseSubmission = z.object({
  name: plainText(120),
  nameChinese: z.string().trim().max(120).default(""),
  description: plainText(2000),
  cityId: z.uuid(),
  neighborhood: plainText(80),
  address: plainText(250),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  image: imageUrl.default(
    "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=1200",
  ),
});
export const placeInput = baseSubmission.extend({
  category: z.enum(placeCategories),
});
export const eventInput = baseSubmission
  .extend({
    category: z.enum(eventCategories),
    organizerId: z.uuid(),
    venue: plainText(150),
    startTime: z.iso.datetime(),
    endTime: z.iso.datetime(),
    capacity: z.number().int().min(1).max(100000).optional(),
  })
  .refine(
    (v) => new Date(v.endTime) > new Date(v.startTime),
    "End must be after start.",
  )
  .refine(
    (v) => new Date(v.startTime).getTime() > Date.now(),
    "Event must be in the future.",
  );
export const moderationInput = z.object({
  entityType: z.enum([
    "places",
    "events",
    "products",
    "organizations",
    "notes",
    "sightings",
    "recommendations",
  ]),
  entityId: z.uuid(),
  action: z.enum(["approved", "rejected", "hidden", "deleted"]),
  reason: plainText(500),
});
export const editInput = z.object({
  name: plainText(120),
  nameChinese: z.string().max(120),
  description: plainText(2000),
  image: imageUrl,
  category: plainText(80),
  descriptionChinese: z.string().max(2000).optional(),
  aliases: z.string().max(500).optional(),
  address: plainText(250).optional(),
  neighborhood: plainText(80).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  website: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).optional(),
  phone: z.string().max(40).optional(),
  hours: z.string().max(500).optional(),
  venue: plainText(150).optional(),
  startTime: z.iso.datetime().optional(),
  endTime: z.iso.datetime().optional(),
  capacity: z.number().int().min(1).max(100000).nullable().optional(),
  brand: plainText(80).optional(),
  onlineUrl: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ })])
    .optional(),
  instagram: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ })])
    .optional(),
  facebook: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ })])
    .optional(),
});
export const listInput = z.object({
  city: z.string().max(80).default("houston"),
  q: z.string().trim().max(100).default(""),
  category: z.string().max(80).optional(),
  neighborhood: z.string().max(80).optional(),
  organization: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.uuid().optional(),
  ),
  sort: z.enum(["popular", "score", "date"]).default("popular"),
  period: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["today", "weekend", "week"]).optional(),
  ),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ListInput = z.infer<typeof listInput>;
export function recommendationScore(
  positive: number,
  total: number,
): number | null {
  return total <= 0 ? null : Math.round((positive / total) * 100);
}
export function placeRank(positive: number, total: number): number {
  return total === 0
    ? 0
    : ((positive + 2) / (total + 4)) * 100 + Math.log1p(total) * 4;
}
export function eventRank(
  start: Date,
  attendees: number,
  followed: boolean,
  featured: boolean,
  now = new Date(),
): number {
  return (
    (followed ? 20 : 0) +
    (featured ? 10 : 0) +
    Math.log1p(attendees) -
    Math.max(0, (start.getTime() - now.getTime()) / 86400000)
  );
}
export function isModerator(role: Role) {
  return role === "MODERATOR" || role === "ADMIN";
}
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
  return actor;
}
export function requireModerator(actor: Actor | null): Actor {
  const a = requireActor(actor);
  if (!isModerator(a.role))
    throw new AppError(403, "FORBIDDEN", "Moderator access required.");
  return a;
}

/** Browser form fields are strings; the API validates converted domain values using the schemas above. */
export type SubmissionFields = Partial<
  Record<
    | keyof z.infer<typeof placeInput>
    | keyof z.infer<typeof eventInput>
    | keyof z.infer<typeof sightingInput>,
    string
  >
>;
