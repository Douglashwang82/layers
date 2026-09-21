import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  geometry,
} from "drizzle-orm/pg-core";
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
const id = () => uuid("id").defaultRandom().primaryKey();
export const city = pgTable("city", {
  id: id(),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  country: text("country").notNull(),
  timezone: text("timezone").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  ...timestamps(),
});
export const user = pgTable("user", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").unique().notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: text("role", { enum: ["USER", "MODERATOR", "ADMIN"] })
    .default("USER")
    .notNull(),
  preferredLanguage: text("preferred_language").default("en").notNull(),
  homeCityId: uuid("home_city_id").references(() => city.id),
  bio: text("bio"),
  ...timestamps(),
});
export const session = pgTable(
  "session",
  {
    id: id(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").unique().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);
export const account = pgTable(
  "account",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("account_provider_idx").on(t.providerId, t.accountId)],
);
export const verification = pgTable("verification", {
  id: id(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  ...timestamps(),
});
const quality = () => ({
  status: text("status", {
    enum: ["pending", "approved", "rejected", "hidden", "deleted"],
  })
    .default("pending")
    .notNull(),
  source: text("source").default("Community submission").notNull(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  verificationStatus: text("verification_status", {
    enum: [
      "UNVERIFIED",
      "COMMUNITY_VERIFIED",
      "OWNER_VERIFIED",
      "ADMIN_VERIFIED",
    ],
  })
    .default("UNVERIFIED")
    .notNull(),
  isDemo: boolean("is_demo").default(false).notNull(),
});
const content = () => ({
  id: id(),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
  nameChinese: text("name_chinese").default("").notNull(),
  description: text("description").default("").notNull(),
  descriptionChinese: text("description_chinese").default("").notNull(),
  image: text("image").notNull(),
  category: text("category").notNull(),
  aliases: text("aliases").default("").notNull(),
  ...quality(),
  ...timestamps(),
});
const location = () => ({
  cityId: uuid("city_id")
    .notNull()
    .references(() => city.id),
  neighborhood: text("neighborhood").notNull(),
  address: text("address").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  location: geometry("location", { type: "point", mode: "xy", srid: 4326 }),
});
export const placeCategory = pgTable("place_category", {
  id: id(),
  name: text("name").unique().notNull(),
  ...timestamps(),
});
export const place = pgTable(
  "place",
  {
    ...content(),
    ...location(),
    categoryId: uuid("category_id").references(() => placeCategory.id),
    website: text("website"),
    phone: text("phone"),
    hours: text("hours"),
    priceLevel: integer("price_level"),
    externalRating: doublePrecision("external_rating"),
    submittedBy: uuid("submitted_by").references(() => user.id),
    claimedBy: uuid("claimed_by").references(() => user.id),
  },
  (t) => [
    index("place_city_status_idx").on(t.cityId, t.status),
    index("place_location_idx").using("gist", t.location),
  ],
);
export const organization = pgTable("organization", {
  ...content(),
  cityId: uuid("city_id")
    .notNull()
    .references(() => city.id),
  website: text("website"),
  instagram: text("instagram"),
  facebook: text("facebook"),
  claimedBy: uuid("claimed_by").references(() => user.id),
});
export const event = pgTable(
  "event",
  {
    ...content(),
    ...location(),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => organization.id),
    venue: text("venue").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    capacity: integer("capacity"),
    externalUrl: text("external_url"),
    eventStatus: text("event_status", {
      enum: ["scheduled", "postponed", "cancelled"],
    })
      .default("scheduled")
      .notNull(),
    featured: boolean("featured").default(false).notNull(),
    submittedBy: uuid("submitted_by").references(() => user.id),
  },
  (t) => [
    index("event_city_start_idx").on(t.cityId, t.startTime),
    index("event_location_idx").using("gist", t.location),
  ],
);
export const product = pgTable("product", {
  ...content(),
  brand: text("brand").notNull(),
  onlineUrl: text("online_url"),
});
export const placeRecommendation = pgTable(
  "place_recommendation",
  {
    id: id(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => place.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    positive: boolean("positive").notNull(),
    status: text("status").default("approved").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("recommendation_user_place").on(t.userId, t.placeId)],
);
export const placeNote = pgTable("place_note", {
  id: id(),
  placeId: uuid("place_id")
    .notNull()
    .references(() => place.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  body: text("body").notNull(),
  ...quality(),
  ...timestamps(),
});
export const eventRSVP = pgTable(
  "event_rsvp",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);
export const organizationFollow = pgTable(
  "organization_follow",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);
export const productSighting = pgTable(
  "product_sighting",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id),
    placeId: uuid("place_id")
      .notNull()
      .references(() => place.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    price: doublePrecision("price"),
    image: text("image"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    ...quality(),
    ...timestamps(),
  },
  (t) => [index("sighting_product_date_idx").on(t.productId, t.observedAt)],
);
export const savedPlace = pgTable(
  "saved_place",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    placeId: uuid("place_id")
      .notNull()
      .references(() => place.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.placeId] })],
);
export const savedEvent = pgTable(
  "saved_event",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] })],
);
export const savedProduct = pgTable(
  "saved_product",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);
export const submission = pgTable("submission", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  status: text("status").default("pending").notNull(),
  reason: text("reason"),
  ...timestamps(),
});
export const image = pgTable("image", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  key: text("key").unique().notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type").notNull(),
  ...timestamps(),
});
export const moderationAction = pgTable("moderation_action", {
  id: id(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => user.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  ...timestamps(),
});
export const analyticsEvent = pgTable(
  "analytics_event",
  {
    id: id(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    properties: jsonb("properties")
      .$type<Record<string, string | number | boolean>>()
      .default({})
      .notNull(),
    ...timestamps(),
  },
  (t) => [index("analytics_user_date_idx").on(t.userId, t.createdAt)],
);
export const rateLimit = pgTable("rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").default(1).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const authRateLimit = pgTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").unique().notNull(),
  count: integer("count").notNull(),
  lastRequest: doublePrecision("last_request").notNull(),
});
// Collection evidence is separate from public catalog and community submissions.
export const contentSource = pgTable("content_source", {
  id: id(),
  name: text("name").notNull(),
  url: text("url").unique().notNull(),
  owner: text("owner"),
  permissionNote: text("permission_note"),
  attribution: text("attribution"),
  kind: text("kind", {
    enum: ["places", "events", "products", "organizations"],
  }).notNull(),
  cityId: uuid("city_id").references(() => city.id),
  enabled: boolean("enabled").default(false).notNull(),
  allowAutoUpdate: boolean("allow_auto_update").default(false).notNull(),
  intervalHours: integer("interval_hours").default(24).notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
  ...timestamps(),
});
export const ingestionRun = pgTable("ingestion_run", {
  id: id(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").default("running").notNull(),
  summary: jsonb("summary")
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
});
export const sourceRecord = pgTable(
  "source_record",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => contentSource.id),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    contentHash: text("content_hash").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    entityId: uuid("entity_id"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("source_record_identity").on(t.sourceId, t.externalId)],
);
export const contentCandidate = pgTable("content_candidate", {
  id: id(),
  sourceRecordId: uuid("source_record_id")
    .notNull()
    .references(() => sourceRecord.id),
  runId: uuid("run_id")
    .notNull()
    .references(() => ingestionRun.id),
  kind: text("kind", {
    enum: ["places", "events", "products", "organizations"],
  }).notNull(),
  status: text("status").default("needs_review").notNull(),
  proposed: jsonb("proposed").$type<Record<string, unknown>>().notNull(),
  baseUpdatedAt: timestamp("base_updated_at", { withTimezone: true }),
  issues: jsonb("issues").$type<string[]>().default([]).notNull(),
  decidedBy: uuid("decided_by").references(() => user.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ...timestamps(),
});
export const entitySource = pgTable("entity_source", {
  sourceRecordId: uuid("source_record_id")
    .primaryKey()
    .references(() => sourceRecord.id),
  kind: text("kind").notNull(),
  entityId: uuid("entity_id").notNull(),
  ...timestamps(),
});
export const contentRevision = pgTable("content_revision", {
  id: id(),
  candidateId: uuid("candidate_id").references(() => contentCandidate.id),
  kind: text("kind").notNull(),
  entityId: uuid("entity_id").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>().notNull(),
  after: jsonb("after").$type<Record<string, unknown>>().notNull(),
  actorId: uuid("actor_id").references(() => user.id),
  ...timestamps(),
});
export const contentFieldLock = pgTable(
  "content_field_lock",
  {
    kind: text("kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    field: text("field").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.entityId, t.field] })],
);
export const generatedFeed = pgTable("generated_feed", {
  slug: text("slug").primaryKey(),
  kind: text("kind", {
    enum: ["places", "events", "products", "organizations"],
  }).notNull(),
  sourceLabel: text("source_label").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  ...timestamps(),
});
