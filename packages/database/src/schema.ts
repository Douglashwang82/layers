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
  type AnyPgColumn,
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
  // text, not uuid: Better Auth writes its own non-UUID ids here (e.g. the
  // email-OTP cleanup lock from reserveVerificationValue), bypassing generateId.
  id: text("id")
    .default(sql`gen_random_uuid()::text`)
    .primaryKey(),
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
  /** Revision of the entity this submission reviews; required for place reviews, null for legacy rows. */
  entityRevision: integer("entity_revision"),
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
/**
 * Pages the extraction adapter reads, one row per page, grouped into a feed by
 * feedSlug. Administrators manage these from /admin/extraction: adding a row is
 * the act of asserting permission for that page, so permissionNote is required
 * and a row starts disabled. lastStatus carries the previous run's outcome back
 * to the interface.
 */
export const extractionPage = pgTable("extraction_page", {
  id: id(),
  feedSlug: text("feed_slug").notNull(),
  kind: text("kind", { enum: ["places", "organizations"] }).notNull(),
  sourceLabel: text("source_label").notNull(),
  url: text("url").unique().notNull(),
  neighborhood: text("neighborhood").default("").notNull(),
  permissionNote: text("permission_note").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status").default("").notNull(),
  addedBy: uuid("added_by").references(() => user.id),
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
/* ---------------------------------------------------------------------------
   Custom places: member-created places owned by a user or a group, visible only
   through that owner's layers. Never part of the public catalog.
   See docs/plans/layer-scoped-places-design.md.
   --------------------------------------------------------------------------- */
export const customPlace = pgTable(
  "custom_place",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    ownerGroupId: uuid("owner_group_id").references(() => group.id, {
      onDelete: "cascade",
    }),
    cityId: uuid("city_id")
      .notNull()
      .references(() => city.id),
    name: text("name").notNull(),
    nameChinese: text("name_chinese").default("").notNull(),
    address: text("address").default("").notNull(),
    /** exact = geocoded address; approximate = member-dropped pin; unspecified = list only. */
    locationStatus: text("location_status", {
      enum: ["exact", "approximate", "unspecified"],
    })
      .default("unspecified")
      .notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    location: geometry("location", { type: "point", mode: "xy", srid: 4326 }),
    categoryId: uuid("category_id").references(() => placeCategory.id),
    website: text("website").default("").notNull(),
    note: text("note").default("").notNull(),
    /** Set when an opt-in suggestion is approved into the catalog; used for dedupe. */
    catalogPlaceId: uuid("catalog_place_id").references(() => place.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["active", "hidden", "deleted"] })
      .default("active")
      .notNull(),
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    index("custom_place_owner_user_idx").on(t.ownerUserId),
    index("custom_place_owner_group_idx").on(t.ownerGroupId),
    check(
      "custom_place_one_owner",
      sql`num_nonnulls(${t.ownerUserId}, ${t.ownerGroupId}) = 1`,
    ),
    check(
      "custom_place_location_check",
      sql`(${t.locationStatus} = 'unspecified') = (${t.latitude} IS NULL AND ${t.longitude} IS NULL) AND num_nonnulls(${t.latitude}, ${t.longitude}) <> 1`,
    ),
    check(
      "custom_place_status_check",
      sql`${t.status} IN ('active', 'hidden', 'deleted')`,
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
    /** External (provider-referenced) place; subjects are soft-deleted, never cascaded. */
    subjectId: uuid("subject_id").references(() => placeSubject.id),
    /** Member-created place scoped to the layer's owner; soft-deleted in normal use. */
    customPlaceId: uuid("custom_place_id").references(() => customPlace.id, {
      onDelete: "cascade",
    }),
    restaurantManaged: boolean("restaurant_managed").notNull().default(false),
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
    uniqueIndex("layer_item_subject_unique")
      .on(t.layerId, t.subjectId)
      .where(sql`${t.subjectId} IS NOT NULL`),
    index("layer_item_subject_idx").on(t.subjectId),
    uniqueIndex("layer_item_custom_place_unique")
      .on(t.layerId, t.customPlaceId)
      .where(sql`${t.customPlaceId} IS NOT NULL`),
    index("layer_item_custom_place_idx").on(t.customPlaceId),
    check(
      "layer_item_one_entity",
      sql`num_nonnulls(${t.placeId}, ${t.eventId}, ${t.contentId}, ${t.subjectId}, ${t.customPlaceId}) = 1`,
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
/* ---------------------------------------------------------------------------
   Invitation-only membership. No public sign-up: an admin bootstraps the first
   members directly; everyone after that is nominated by an existing member and
   approved by a reviewer (a capability, not a role). Platform admission is
   independent of group invitations. See docs/plans/invitation-membership-implementation-plan.md
   and docs/adr/0001-membership-invitation-auth-transaction-boundary.md.
   --------------------------------------------------------------------------- */
export const membershipReviewer = pgTable("membership_reviewer", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  grantedBy: uuid("granted_by")
    .notNull()
    .references(() => user.id),
  grantedAt: timestamp("granted_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  revokedBy: uuid("revoked_by").references(() => user.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
export const membershipBatch = pgTable(
  "membership_batch",
  {
    id: id(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .default("open")
      .notNull(),
    createdBy: uuid("created_by").references(() => user.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("membership_batch_single_open")
      .on(t.status)
      .where(sql`${t.status} = 'open'`),
    check("membership_batch_capacity_positive", sql`${t.capacity} > 0`),
  ],
);
export const membershipNomination = pgTable(
  "membership_nomination",
  {
    id: id(),
    emailNormalized: text("email_normalized").notNull(),
    nominatorId: uuid("nominator_id").references(() => user.id),
    source: text("source", {
      enum: ["member", "admin_direct", "operator_bootstrap"],
    }).notNull(),
    note: text("note"),
    status: text("status", {
      enum: [
        "pending_review",
        "needs_info",
        "approved",
        "joined",
        "withdrawn",
        "rejected",
        "closed",
      ],
    })
      .default("pending_review")
      .notNull(),
    revision: integer("revision").default(1).notNull(),
    approvedBy: uuid("approved_by").references(() => user.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("membership_nomination_email_idx").on(t.emailNormalized),
    uniqueIndex("membership_nomination_open_email")
      .on(t.emailNormalized)
      .where(sql`${t.status} IN ('pending_review', 'needs_info', 'approved')`),
    check(
      "membership_nomination_nominator_required",
      sql`${t.source} = 'operator_bootstrap' OR ${t.nominatorId} IS NOT NULL`,
    ),
  ],
);
export const membershipInvitation = pgTable(
  "membership_invitation",
  {
    id: id(),
    nominationId: uuid("nomination_id")
      .notNull()
      .unique()
      .references(() => membershipNomination.id),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => membershipBatch.id),
    delivery: text("delivery", { enum: ["manual", "email"] }).notNull(),
    tokenHash: text("token_hash").unique().notNull(),
    tokenVersion: integer("token_version").default(1).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status", {
      enum: ["issued", "redeemed", "revoked", "expired"],
    })
      .default("issued")
      .notNull(),
    redeemedBy: uuid("redeemed_by").references(() => user.id),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => user.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("membership_invitation_batch_status_idx").on(t.batchId, t.status),
  ],
);
export const membershipAdmission = pgTable(
  "membership_admission",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source", {
      enum: ["legacy", "invitation", "operator_bootstrap"],
    }).notNull(),
    invitationId: uuid("invitation_id")
      .unique()
      .references(() => membershipInvitation.id),
    admittedAt: timestamp("admitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    termsVersion: text("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "membership_admission_invitation_required",
      sql`${t.source} = 'legacy' OR ${t.invitationId} IS NOT NULL`,
    ),
  ],
);
export const membershipJoinContext = pgTable(
  "membership_join_context",
  {
    id: id(),
    secretHash: text("secret_hash").unique().notNull(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => membershipInvitation.id),
    tokenVersion: integer("token_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    termsVersion: text("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("membership_join_context_invitation_idx").on(t.invitationId)],
);
/** Append-only. Never updated or deleted; carries no token/OTP material. */
export const membershipAudit = pgTable(
  "membership_audit",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => user.id),
    action: text("action").notNull(),
    nominationId: uuid("nomination_id").references(
      () => membershipNomination.id,
    ),
    invitationId: uuid("invitation_id").references(
      () => membershipInvitation.id,
    ),
    targetUserId: uuid("target_user_id").references(() => user.id),
    beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
    afterState: jsonb("after_state").$type<Record<string, unknown>>(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("membership_audit_nomination_idx").on(t.nominationId),
    index("membership_audit_invitation_idx").on(t.invitationId),
  ],
);
export const mailOutbox = pgTable(
  "mail_outbox",
  {
    id: id(),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").unique().notNull(),
    recipient: text("recipient").notNull(),
    payloadCiphertext: text("payload_ciphertext").notNull(),
    payloadKeyVersion: integer("payload_key_version").notNull(),
    status: text("status", {
      enum: ["queued", "provider_accepted", "failed", "superseded"],
    })
      .default("queued")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    /** Unique per worker claim; final updates must match it. */
    leaseOwner: text("lease_owner"),
    /** Set before the first provider call; bounds replay to the provider's idempotency window. */
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    /** Sender frozen at the first attempt so retries repeat the same provider request. */
    sender: text("sender"),
    providerMessageId: text("provider_message_id"),
    lastErrorCode: text("last_error_code"),
    ...timestamps(),
  },
  (t) => [index("mail_outbox_next_attempt_idx").on(t.status, t.nextAttemptAt)],
);
/** Actor-scoped idempotency for membership create/approve/direct-invite/reissue calls. */
export const membershipRequest = pgTable(
  "membership_request",
  {
    id: id(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    resultEntityId: uuid("result_entity_id"),
    resultVersion: integer("result_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("membership_request_identity").on(
      t.actorId,
      t.operation,
      t.idempotencyKey,
    ),
  ],
);
/* ---------------------------------------------------------------------------
   Place subjects: the local identity TaiwanHub contributions attach to. A
   subject is either a lazily created wrapper around a catalog place or an
   external business known only by a provider reference. Only provider IDs are
   stored — never provider names, addresses, photos, ratings or coordinates.
   See docs/plans/google-places-implementation-plan.md section 5.
   --------------------------------------------------------------------------- */
export const placeSubject = pgTable(
  "place_subject",
  {
    id: id(),
    catalogPlaceId: uuid("catalog_place_id")
      .unique()
      .references(() => place.id),
    /** Local curation metadata; null until a moderator reviews it or a catalog link supplies it. */
    cityId: uuid("city_id").references(() => city.id),
    cityReviewStatus: text("city_review_status", {
      enum: ["unreviewed", "approved"],
    })
      .default("unreviewed")
      .notNull(),
    cityReviewedBy: uuid("city_reviewed_by").references(() => user.id),
    cityReviewedAt: timestamp("city_reviewed_at", { withTimezone: true }),
    status: text("status", { enum: ["active", "hidden", "deleted"] })
      .default("active")
      .notNull(),
    revision: integer("revision").default(1).notNull(),
    ...timestamps(),
  },
  (t) => [
    index("place_subject_city_review_idx").on(t.cityReviewStatus, t.createdAt),
    check(
      "place_subject_city_review_status_check",
      sql`${t.cityReviewStatus} IN ('unreviewed', 'approved')`,
    ),
    check(
      "place_subject_status_check",
      sql`${t.status} IN ('active', 'hidden', 'deleted')`,
    ),
    check(
      "place_subject_approved_city_check",
      sql`${t.cityReviewStatus} = 'unreviewed' OR ${t.cityId} IS NOT NULL`,
    ),
    check("place_subject_revision_check", sql`${t.revision} >= 1`),
  ],
);
export const placeProviderReference = pgTable(
  "place_provider_reference",
  {
    id: id(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => placeSubject.id),
    provider: text("provider", { enum: ["google"] }).notNull(),
    providerPlaceId: text("provider_place_id").notNull(),
    /** Superseded IDs stay as aliases so an old ID still reaches the same subject. */
    state: text("state", { enum: ["current", "superseded"] })
      .default("current")
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("place_provider_reference_identity").on(
      t.provider,
      t.providerPlaceId,
    ),
    uniqueIndex("place_provider_reference_current")
      .on(t.subjectId, t.provider)
      .where(sql`${t.state} = 'current'`),
    index("place_provider_reference_subject_idx").on(t.subjectId),
    check(
      "place_provider_reference_provider_check",
      sql`${t.provider} = 'google'`,
    ),
    check(
      "place_provider_reference_state_check",
      sql`${t.state} IN ('current', 'superseded')`,
    ),
    check(
      "place_provider_reference_id_length",
      sql`char_length(${t.providerPlaceId}) BETWEEN 1 AND 512`,
    ),
  ],
);
/** Saves of external subjects. Catalog-linked subjects keep using saved_place. */
export const savedPlaceSubject = pgTable(
  "saved_place_subject",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => placeSubject.id),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.subjectId] }),
    index("saved_place_subject_subject_idx").on(t.subjectId),
  ],
);
/**
 * A member's review of a place within one scope: a layer (visible to that
 * layer's viewers) or a group (members only). Aggregates are per scope and
 * never merged. See the "Scoped reviews" section of the implementation plan.
 */
export const placeReview = pgTable(
  "place_review",
  {
    id: id(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => placeSubject.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    scopeKind: text("scope_kind", { enum: ["layer", "group"] }).notNull(),
    layerId: uuid("layer_id").references(() => layer.id, {
      onDelete: "cascade",
    }),
    groupId: uuid("group_id").references(() => group.id, {
      onDelete: "cascade",
    }),
    stars: integer("stars"),
    body: text("body").default("").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "hidden", "deleted"],
    }).notNull(),
    deletionSource: text("deletion_source", { enum: ["author", "moderator"] }),
    /** Set when a moderator approved the current content; null for scope-trusted auto-approval. */
    moderatedBy: uuid("moderated_by").references(() => user.id),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    revision: integer("revision").default(1).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("place_review_layer_unique")
      .on(t.subjectId, t.userId, t.layerId)
      .where(sql`${t.layerId} IS NOT NULL`),
    uniqueIndex("place_review_group_unique")
      .on(t.subjectId, t.userId, t.groupId)
      .where(sql`${t.groupId} IS NOT NULL`),
    index("place_review_layer_idx").on(
      t.layerId,
      t.subjectId,
      t.status,
      t.createdAt,
    ),
    index("place_review_group_idx").on(
      t.groupId,
      t.subjectId,
      t.status,
      t.createdAt,
    ),
    index("place_review_user_idx").on(t.userId),
    index("place_review_subject_idx").on(t.subjectId),
    check(
      "place_review_scope_check",
      sql`(${t.scopeKind} = 'layer' AND ${t.layerId} IS NOT NULL AND ${t.groupId} IS NULL) OR (${t.scopeKind} = 'group' AND ${t.groupId} IS NOT NULL AND ${t.layerId} IS NULL)`,
    ),
    check(
      "place_review_stars_check",
      sql`${t.stars} IS NULL OR ${t.stars} BETWEEN 1 AND 5`,
    ),
    check("place_review_body_length", sql`char_length(${t.body}) <= 2000`),
    check(
      "place_review_not_empty",
      sql`${t.stars} IS NOT NULL OR char_length(btrim(${t.body})) > 0`,
    ),
    check(
      "place_review_status_check",
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'hidden', 'deleted')`,
    ),
    check(
      "place_review_deletion_check",
      sql`(${t.status} = 'deleted') = (${t.deletionSource} IS NOT NULL)`,
    ),
    check("place_review_revision_check", sql`${t.revision} >= 1`),
  ],
);
/** Append-only snapshot of every content/status revision of a review. Never exposed publicly. */
export const placeReviewRevision = pgTable(
  "place_review_revision",
  {
    id: id(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => placeReview.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    actorId: uuid("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    changeKind: text("change_kind").notNull(),
    stars: integer("stars"),
    body: text("body").notNull(),
    status: text("status").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("place_review_revision_identity").on(t.reviewId, t.revision),
  ],
);
/**
 * Daily Pick publication slots: at most one published pick per city and
 * city-local date, enforced by a partial unique index so concurrent runs cannot
 * publish different picks. Description and reasons are dated snapshots; the
 * place is always re-checked for visibility on read. Replacements withdraw the
 * previous row and link to it; human actions are also in moderation_action.
 */
export const dailyPick = pgTable(
  "daily_pick",
  {
    id: id(),
    cityId: uuid("city_id")
      .notNull()
      .references(() => city.id),
    pickDate: date("pick_date").notNull(),
    /** Nullable for a version 2 external-subject pick; version 1 catalog picks keep it. */
    placeId: uuid("place_id").references(() => place.id),
    /** Version 2 canonical identity; null for legacy version 1 catalog-only picks. */
    subjectId: uuid("subject_id").references(() => placeSubject.id),
    /** Reviewed primary food type snapshot at publication (version 2 only). */
    foodType: text("food_type"),
    foodTypeVersion: integer("food_type_version"),
    runId: uuid("run_id").references((): AnyPgColumn => dailyPickRun.id),
    copyId: uuid("copy_id").references((): AnyPgColumn => restaurantCopy.id),
    status: text("status", { enum: ["published", "withdrawn"] })
      .default("published")
      .notNull(),
    selectionKind: text("selection_kind", {
      enum: ["automatic", "editorial"],
    }).notNull(),
    selectionVersion: integer("selection_version").notNull(),
    description: text("description").notNull(),
    descriptionChinese: text("description_chinese").default("").notNull(),
    /** Structured reasons that decided the selection (see @taiwanhub/shared dailyPickReason). */
    reasons: jsonb("reasons").$type<unknown[]>().default([]).notNull(),
    reasonText: text("reason_text").notNull(),
    reasonTextChinese: text("reason_text_chinese").notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    replacesId: uuid("replaces_id").references((): AnyPgColumn => dailyPick.id),
    /** Null for the scheduled job; the moderator for editorial picks. */
    createdBy: uuid("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: uuid("withdrawn_by").references(() => user.id, {
      onDelete: "set null",
    }),
    withdrawalReason: text("withdrawal_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("daily_pick_city_date_published")
      .on(t.cityId, t.pickDate)
      .where(sql`${t.status} = 'published'`),
    index("daily_pick_city_date_idx").on(t.cityId, t.pickDate),
    index("daily_pick_place_idx").on(t.placeId),
    index("daily_pick_subject_idx").on(t.subjectId),
    check(
      "daily_pick_status_check",
      sql`${t.status} IN ('published', 'withdrawn')`,
    ),
    check(
      "daily_pick_selection_kind_check",
      sql`${t.selectionKind} IN ('automatic', 'editorial')`,
    ),
    check(
      "daily_pick_withdrawal_check",
      sql`(${t.status} = 'withdrawn') = (${t.withdrawnAt} IS NOT NULL)`,
    ),
    /** Every pick needs an identity: a version 1 catalog place, a version 2 subject, or both. */
    check(
      "daily_pick_identity_check",
      sql`num_nonnulls(${t.placeId}, ${t.subjectId}) >= 1`,
    ),
  ],
);

/* ---------------------------------------------------------------------------
   Daily restaurant recommendation (version 2), additive to the tables above.
   See docs/plans/daily-restaurant-recommendation-implementation-plan.md
   section 9. Provider content is never cached wholesale here: candidates and
   evidence hold only durable, permission-scoped facts and local decisions,
   never raw provider payloads.
   --------------------------------------------------------------------------- */
/** One area/city configuration for the restaurant pipeline; immutable per config version. */
export const restaurantDiscoveryArea = pgTable(
  "restaurant_discovery_area",
  {
    id: id(),
    citySlug: text("city_slug").notNull(),
    layerSlug: text("layer_slug").notNull(),
    timezone: text("timezone").notNull(),
    configVersion: integer("config_version").default(1).notNull(),
    /** Boundary version, included communities, query groups, budgets and rule thresholds. */
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    /** Master gate: discovery/evaluation never runs for a disabled area. */
    enabled: boolean("enabled").default(false).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("restaurant_discovery_area_city_unique").on(t.citySlug),
    check(
      "restaurant_discovery_area_config_version_check",
      sql`${t.configVersion} >= 1`,
    ),
  ],
);
export const restaurantCandidateStates = [
  "discovered",
  "reviewing",
  "approved",
  "excluded",
] as const;
/** One restaurant discovered for an area; a candidate is not automatically public. */
export const restaurantCandidate = pgTable(
  "restaurant_candidate",
  {
    id: id(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => restaurantDiscoveryArea.id),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => placeSubject.id),
    state: text("state", { enum: restaurantCandidateStates })
      .default("discovered")
      .notNull(),
    /** One primary food type: moderator-set, LLM-suggested, or mapped from the provider's primary type in auto-approve areas. */
    foodType: text("food_type"),
    foodTypeVersion: integer("food_type_version"),
    foodTypeSource: text("food_type_source", {
      enum: ["llm_suggested", "moderator", "provider"],
    }),
    excludedReason: text("excluded_reason"),
    reviewedBy: uuid("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("restaurant_candidate_area_subject_unique").on(
      t.areaId,
      t.subjectId,
    ),
    index("restaurant_candidate_area_state_idx").on(t.areaId, t.state),
    check(
      "restaurant_candidate_state_check",
      sql`${t.state} IN ('discovered', 'reviewing', 'approved', 'excluded')`,
    ),
    check(
      "restaurant_candidate_food_source_check",
      sql`${t.foodTypeSource} IS NULL OR ${t.foodTypeSource} IN ('llm_suggested', 'moderator', 'provider')`,
    ),
  ],
);
/** Permission-compatible independent facts backing a candidate's recommendation. */
export const restaurantEvidence = pgTable(
  "restaurant_evidence",
  {
    id: id(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => restaurantCandidate.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sourceUrl: text("source_url"),
    approvedForCopy: boolean("approved_for_copy").default(false).notNull(),
    approvedBy: uuid("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    revision: integer("revision").default(1).notNull(),
    ...timestamps(),
  },
  (t) => [
    index("restaurant_evidence_candidate_idx").on(t.candidateId),
    check(
      "restaurant_evidence_label_length",
      sql`char_length(${t.label}) BETWEEN 1 AND 200`,
    ),
    check("restaurant_evidence_revision_check", sql`${t.revision} >= 1`),
  ],
);
export const restaurantDiscoveryRunStatuses = [
  "queued",
  "running",
  "success",
  "partial",
  "failed",
] as const;
/** One discovery attempt for an area/day; leased so a recovered worker can't double-run. */
export const restaurantDiscoveryRun = pgTable(
  "restaurant_discovery_run",
  {
    id: id(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => restaurantDiscoveryArea.id),
    runDate: date("run_date").notNull(),
    attempt: integer("attempt").default(1).notNull(),
    status: text("status", { enum: restaurantDiscoveryRunStatuses })
      .default("queued")
      .notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    requestCount: integer("request_count").default(0).notNull(),
    discoveredCount: integer("discovered_count").default(0).notNull(),
    /** Sanitized query-group outcomes and truncation/failure notes; never raw payloads. */
    errors: jsonb("errors").$type<unknown[]>().default([]).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("restaurant_discovery_run_identity").on(
      t.areaId,
      t.runDate,
      t.attempt,
    ),
    index("restaurant_discovery_run_area_date_idx").on(t.areaId, t.runDate),
    check(
      "restaurant_discovery_run_status_check",
      sql`${t.status} IN ('queued', 'running', 'success', 'partial', 'failed')`,
    ),
    check("restaurant_discovery_run_attempt_check", sql`${t.attempt} >= 1`),
  ],
);
/** Validated, moderator-reviewed bilingual copy for one candidate/run, pending approval. */
export const restaurantCopy = pgTable(
  "restaurant_copy",
  {
    id: id(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => restaurantCandidate.id),
    runId: uuid("run_id").references((): AnyPgColumn => dailyPickRun.id),
    /** RestaurantCopySentence[] from @taiwanhub/shared: { text, factIds }. */
    enSentences: jsonb("en_sentences").$type<unknown[]>().notNull(),
    zhSentences: jsonb("zh_sentences").$type<unknown[]>().notNull(),
    promptVersion: text("prompt_version").notNull(),
    modelVersion: text("model_version").notNull(),
    reviewStatus: text("review_status", {
      enum: ["pending", "approved", "rejected"],
    })
      .default("pending")
      .notNull(),
    reviewedBy: uuid("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("restaurant_copy_candidate_idx").on(t.candidateId),
    index("restaurant_copy_run_idx").on(t.runId),
    check(
      "restaurant_copy_review_status_check",
      sql`${t.reviewStatus} IN ('pending', 'approved', 'rejected')`,
    ),
  ],
);
export const dailyPickRunStatuses = [
  "queued",
  "discovering",
  "evaluating",
  "writing",
  "ready_for_review",
  "ready_to_publish",
  "published",
  "empty",
  "partial",
  "failed",
  "superseded",
  "canceled",
] as const;
/** One selection attempt for an area/day: lifecycle, evaluated scope, and the final pick. */
export const dailyPickRun = pgTable(
  "daily_pick_run",
  {
    id: id(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => restaurantDiscoveryArea.id),
    runDate: date("run_date").notNull(),
    attempt: integer("attempt").default(1).notNull(),
    status: text("status", { enum: dailyPickRunStatuses })
      .default("queued")
      .notNull(),
    configVersion: integer("config_version").notNull(),
    rulesConfig: jsonb("rules_config")
      .$type<Record<string, unknown>>()
      .notNull(),
    evaluatedCount: integer("evaluated_count").default(0).notNull(),
    eligibleCount: integer("eligible_count").default(0).notNull(),
    excludedCount: integer("excluded_count").default(0).notNull(),
    copyStatus: text("copy_status", {
      enum: ["pending", "approved", "rejected", "not_needed"],
    })
      .default("pending")
      .notNull(),
    reviewedBy: uuid("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    finalPickId: uuid("final_pick_id").references(
      (): AnyPgColumn => dailyPick.id,
    ),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    /** Safe, non-sensitive failure classification; never a raw provider/model error string. */
    errorCode: text("error_code"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("daily_pick_run_identity").on(t.areaId, t.runDate, t.attempt),
    index("daily_pick_run_area_date_idx").on(t.areaId, t.runDate),
    check("daily_pick_run_attempt_check", sql`${t.attempt} >= 1`),
    check(
      "daily_pick_run_status_check",
      sql`${t.status} IN ('queued', 'discovering', 'evaluating', 'writing', 'ready_for_review', 'ready_to_publish', 'published', 'empty', 'partial', 'failed', 'superseded', 'canceled')`,
    ),
    check(
      "daily_pick_run_copy_status_check",
      sql`${t.copyStatus} IN ('pending', 'approved', 'rejected', 'not_needed')`,
    ),
  ],
);
export const dailyPickRunCandidateDecisions = [
  "picked",
  "eligible_not_picked",
  "excluded",
] as const;
/** One report row: this run's evaluated pool, not a global top-ten of the city. */
export const dailyPickRunCandidate = pgTable(
  "daily_pick_run_candidate",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => dailyPickRun.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => placeSubject.id),
    baseRank: integer("base_rank").notNull(),
    eligibleRank: integer("eligible_rank"),
    reportPosition: integer("report_position").notNull(),
    decision: text("decision", {
      enum: dailyPickRunCandidateDecisions,
    }).notNull(),
    score: doublePrecision("score"),
    primaryReasonCode: text("primary_reason_code").notNull(),
    reasonCodes: jsonb("reason_codes").$type<string[]>().default([]).notNull(),
    /**
     * A snapshot fingerprint (subject/candidate/evidence state) captured when
     * this row was written, used only for the picked row: publication
     * recomputes the same fingerprint from live data and refuses to commit on
     * a mismatch, so evidence or review state that changed after the report
     * was written can never be silently published.
     */
    fingerprint: text("fingerprint"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("daily_pick_run_candidate_identity").on(t.runId, t.subjectId),
    index("daily_pick_run_candidate_report_idx").on(t.runId, t.reportPosition),
    check(
      "daily_pick_run_candidate_decision_check",
      sql`${t.decision} IN ('picked', 'eligible_not_picked', 'excluded')`,
    ),
  ],
);
/**
 * Provenance linking a published external-subject pick to its Discover
 * layer_item row, so a withdrawal or catalog link can find and remove exactly
 * that membership without touching independently-added items.
 */
export const dailyPickLayerMembership = pgTable(
  "daily_pick_layer_membership",
  {
    id: id(),
    pickId: uuid("pick_id")
      .notNull()
      .references(() => dailyPick.id, { onDelete: "cascade" }),
    layerId: uuid("layer_id")
      .notNull()
      .references(() => layer.id),
    layerItemId: uuid("layer_item_id")
      .notNull()
      .references(() => layerItem.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [
    // One row per (pick, layer): an external winner contributes to both its
    // area's Discover layer AND the city's separate Daily Pick layer, so a
    // single pick can legitimately have more than one membership row.
    uniqueIndex("daily_pick_layer_membership_pick_layer_unique").on(
      t.pickId,
      t.layerId,
    ),
    // Intentionally NOT unique: the same restaurant can win again after its
    // rotation window, contributing a second membership row to the SAME
    // shared layer_item (see daily-pick-restaurant-run.ts publishRestaurantPick).
    // A unique constraint here previously made a repeat winner impossible to
    // publish (its layer_item already had one membership row) and made
    // ON CONFLICT re-publication silently overwrite the earlier pick's row.
    index("daily_pick_layer_membership_item_idx").on(t.layerItemId),
    index("daily_pick_layer_membership_layer_idx").on(t.layerId),
  ],
);

/** Durable worker queue; HTTP actions never call paid providers. */
export const restaurantJob = pgTable(
  "restaurant_job",
  {
    id: id(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => restaurantDiscoveryArea.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => dailyPickRun.id, {
      onDelete: "cascade",
    }),
    runDate: date("run_date").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    requestedBy: uuid("requested_by").references(() => user.id),
    expectedPickId: uuid("expected_pick_id").references(() => dailyPick.id, {
      onDelete: "set null",
    }),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    result: jsonb("result"),
    ...timestamps(),
  },
  (t) => [
    check("restaurant_job_kind_check", sql`${t.kind} IN ('prepare','publish')`),
    check(
      "restaurant_job_status_check",
      sql`${t.status} IN ('queued','running','succeeded','failed')`,
    ),
    uniqueIndex("restaurant_job_pending_unique")
      .on(t.areaId, t.runDate, t.kind)
      .where(sql`${t.status} IN ('queued','running')`),
  ],
);
