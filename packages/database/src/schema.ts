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
  check,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
  isDemo: boolean("is_demo").default(false).notNull(),
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
/* ---------------------------------------------------------------------------
   Groups, local content and layers. A layer is a saved collection applied to
   the map; ownership, audience and schedule are independent dimensions.
   Membership rows reference exactly one canonical entity — nothing is copied
   out of the catalog. Group roles belong to the group and inherit into layers.
   --------------------------------------------------------------------------- */
export const group = pgTable(
  "group",
  {
    id: id(),
    slug: text("slug").unique().notNull(),
    name: text("name").notNull(),
    nameChinese: text("name_chinese").default("").notNull(),
    description: text("description").default("").notNull(),
    cityId: uuid("city_id")
      .notNull()
      .references(() => city.id),
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [index("group_city_idx").on(t.cityId)],
);
export const groupMember = pgTable(
  "group_member",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "viewer"] })
      .default("viewer")
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_member_user_idx").on(t.userId),
  ],
);
export const groupInvite = pgTable(
  "group_invite",
  {
    id: id(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["editor", "viewer"] })
      .default("viewer")
      .notNull(),
    token: text("token").unique().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [index("group_invite_group_idx").on(t.groupId)],
);
export const contentPost = pgTable(
  "content_post",
  {
    id: id(),
    slug: text("slug").unique().notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cityId: uuid("city_id")
      .notNull()
      .references(() => city.id),
    title: text("title").notNull(),
    titleChinese: text("title_chinese").default("").notNull(),
    body: text("body").notNull(),
    image: text("image"),
    sourceUrl: text("source_url"),
    placeId: uuid("place_id").references(() => place.id, {
      onDelete: "set null",
    }),
    eventId: uuid("event_id").references(() => event.id, {
      onDelete: "set null",
    }),
    locationStatus: text("location_status", {
      enum: ["exact", "approximate", "citywide", "online", "unspecified"],
    })
      .default("unspecified")
      .notNull(),
    neighborhood: text("neighborhood").default("").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    ...quality(),
    ...timestamps(),
  },
  (t) => [
    index("content_post_city_status_idx").on(t.cityId, t.status),
    index("content_post_author_idx").on(t.authorId),
  ],
);
export const savedContent = pgTable(
  "saved_content",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contentPost.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contentId] })],
);
export const layer = pgTable(
  "layer",
  {
    id: id(),
    slug: text("slug").unique().notNull(),
    title: text("title").notNull(),
    titleChinese: text("title_chinese").default("").notNull(),
    description: text("description").default("").notNull(),
    descriptionChinese: text("description_chinese").default("").notNull(),
    cityId: uuid("city_id")
      .notNull()
      .references(() => city.id),
    ownerKind: text("owner_kind", {
      enum: ["system", "user", "group"],
    }).notNull(),
    ownerUserId: uuid("owner_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    ownerGroupId: uuid("owner_group_id").references(() => group.id, {
      onDelete: "cascade",
    }),
    audience: text("audience", { enum: ["public", "private", "group"] })
      .default("private")
      .notNull(),
    schedule: text("schedule", {
      enum: ["evergreen", "day", "range", "rolling_today"],
    })
      .default("evergreen")
      .notNull(),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    rule: jsonb("rule").$type<{ version: 1; kind: string }>(),
    lifecycle: text("lifecycle", { enum: ["draft", "active", "archived"] })
      .default("draft")
      .notNull(),
    reviewStatus: text("review_status", {
      enum: ["unsubmitted", "pending", "approved", "rejected", "hidden"],
    })
      .default("unsubmitted")
      .notNull(),
    revision: integer("revision").default(1).notNull(),
    coverImage: text("cover_image"),
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedBy: uuid("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    index("layer_city_owner_idx").on(t.cityId, t.ownerKind),
    index("layer_owner_user_idx").on(t.ownerUserId),
    index("layer_owner_group_idx").on(t.ownerGroupId),
    check(
      "layer_owner_check",
      sql`(${t.ownerKind} = 'system' AND ${t.ownerUserId} IS NULL AND ${t.ownerGroupId} IS NULL) OR (${t.ownerKind} = 'user' AND ${t.ownerUserId} IS NOT NULL AND ${t.ownerGroupId} IS NULL) OR (${t.ownerKind} = 'group' AND ${t.ownerGroupId} IS NOT NULL AND ${t.ownerUserId} IS NULL)`,
    ),
    check(
      "layer_schedule_check",
      sql`(${t.schedule} IN ('evergreen','rolling_today')) OR (${t.schedule} = 'day' AND ${t.startsOn} IS NOT NULL) OR (${t.schedule} = 'range' AND ${t.startsOn} IS NOT NULL AND ${t.endsOn} IS NOT NULL AND ${t.startsOn} <= ${t.endsOn})`,
    ),
  ],
);
export const layerItem = pgTable(
  "layer_item",
  {
    id: id(),
    layerId: uuid("layer_id")
      .notNull()
      .references(() => layer.id, { onDelete: "cascade" }),
    placeId: uuid("place_id").references(() => place.id, {
      onDelete: "cascade",
    }),
    eventId: uuid("event_id").references(() => event.id, {
      onDelete: "cascade",
    }),
    contentId: uuid("content_id").references(() => contentPost.id, {
      onDelete: "cascade",
    }),
    note: text("note").default("").notNull(),
    position: integer("position").default(0).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    addedBy: uuid("added_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    index("layer_item_layer_idx").on(t.layerId, t.position),
    uniqueIndex("layer_item_place_unique")
      .on(t.layerId, t.placeId)
      .where(sql`${t.placeId} IS NOT NULL`),
    uniqueIndex("layer_item_event_unique")
      .on(t.layerId, t.eventId)
      .where(sql`${t.eventId} IS NOT NULL`),
    uniqueIndex("layer_item_content_unique")
      .on(t.layerId, t.contentId)
      .where(sql`${t.contentId} IS NOT NULL`),
    check(
      "layer_item_one_entity",
      sql`num_nonnulls(${t.placeId}, ${t.eventId}, ${t.contentId}) = 1`,
    ),
  ],
);
export const layerFollow = pgTable(
  "layer_follow",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    layerId: uuid("layer_id")
      .notNull()
      .references(() => layer.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.layerId] })],
);
/** Authorized active layers and view preference only; never a location trail. */
export const userMapPreference = pgTable("user_map_preference", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  activeLayers: jsonb("active_layers").$type<string[]>().default([]).notNull(),
  view: text("view", { enum: ["map", "list"] })
    .default("map")
    .notNull(),
  ...timestamps(),
});
