CREATE TABLE "content_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"author_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"title" text NOT NULL,
	"title_chinese" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"image" text,
	"source_url" text,
	"place_id" uuid,
	"event_id" uuid,
	"location_status" text DEFAULT 'unspecified' NOT NULL,
	"neighborhood" text DEFAULT '' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'Community submission' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"verification_status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_post_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_chinese" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"city_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "group_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_invite_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "group_member" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_member_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "layer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"title_chinese" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"description_chinese" text DEFAULT '' NOT NULL,
	"city_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_user_id" uuid,
	"owner_group_id" uuid,
	"audience" text DEFAULT 'private' NOT NULL,
	"schedule" text DEFAULT 'evergreen' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"rule" jsonb,
	"lifecycle" text DEFAULT 'draft' NOT NULL,
	"review_status" text DEFAULT 'unsubmitted' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"cover_image" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layer_slug_unique" UNIQUE("slug"),
	CONSTRAINT "layer_owner_check" CHECK (("layer"."owner_kind" = 'system' AND "layer"."owner_user_id" IS NULL AND "layer"."owner_group_id" IS NULL) OR ("layer"."owner_kind" = 'user' AND "layer"."owner_user_id" IS NOT NULL AND "layer"."owner_group_id" IS NULL) OR ("layer"."owner_kind" = 'group' AND "layer"."owner_group_id" IS NOT NULL AND "layer"."owner_user_id" IS NULL)),
	CONSTRAINT "layer_schedule_check" CHECK (("layer"."schedule" IN ('evergreen','rolling_today')) OR ("layer"."schedule" = 'day' AND "layer"."starts_on" IS NOT NULL) OR ("layer"."schedule" = 'range' AND "layer"."starts_on" IS NOT NULL AND "layer"."ends_on" IS NOT NULL AND "layer"."starts_on" <= "layer"."ends_on"))
);
--> statement-breakpoint
CREATE TABLE "layer_follow" (
	"user_id" uuid NOT NULL,
	"layer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layer_follow_user_id_layer_id_pk" PRIMARY KEY("user_id","layer_id")
);
--> statement-breakpoint
CREATE TABLE "layer_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layer_id" uuid NOT NULL,
	"place_id" uuid,
	"event_id" uuid,
	"content_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layer_item_one_entity" CHECK (num_nonnulls("layer_item"."place_id", "layer_item"."event_id", "layer_item"."content_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "saved_content" (
	"user_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_content_user_id_content_id_pk" PRIMARY KEY("user_id","content_id")
);
--> statement-breakpoint
CREATE TABLE "user_map_preference" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"active_layers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"view" text DEFAULT 'map' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_post" ADD CONSTRAINT "content_post_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_post" ADD CONSTRAINT "content_post_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_post" ADD CONSTRAINT "content_post_place_id_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."place"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_post" ADD CONSTRAINT "content_post_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invite" ADD CONSTRAINT "group_invite_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invite" ADD CONSTRAINT "group_invite_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer" ADD CONSTRAINT "layer_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer" ADD CONSTRAINT "layer_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer" ADD CONSTRAINT "layer_owner_group_id_group_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer" ADD CONSTRAINT "layer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer" ADD CONSTRAINT "layer_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_follow" ADD CONSTRAINT "layer_follow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_follow" ADD CONSTRAINT "layer_follow_layer_id_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_layer_id_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_place_id_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."place"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_content_id_content_post_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_content" ADD CONSTRAINT "saved_content_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_content" ADD CONSTRAINT "saved_content_content_id_content_post_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_map_preference" ADD CONSTRAINT "user_map_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_post_city_status_idx" ON "content_post" USING btree ("city_id","status");--> statement-breakpoint
CREATE INDEX "content_post_author_idx" ON "content_post" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "group_city_idx" ON "group" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "group_invite_group_idx" ON "group_invite" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_member_user_idx" ON "group_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "layer_city_owner_idx" ON "layer" USING btree ("city_id","owner_kind");--> statement-breakpoint
CREATE INDEX "layer_owner_user_idx" ON "layer" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "layer_owner_group_idx" ON "layer" USING btree ("owner_group_id");--> statement-breakpoint
CREATE INDEX "layer_item_layer_idx" ON "layer_item" USING btree ("layer_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "layer_item_place_unique" ON "layer_item" USING btree ("layer_id","place_id") WHERE "layer_item"."place_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "layer_item_event_unique" ON "layer_item" USING btree ("layer_id","event_id") WHERE "layer_item"."event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "layer_item_content_unique" ON "layer_item" USING btree ("layer_id","content_id") WHERE "layer_item"."content_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "layer"(slug,title,title_chinese,description,description_chinese,city_id,owner_kind,audience,schedule,rule,lifecycle,review_status) SELECT 'discover-'||slug,'Discover '||name,'探索'||name,'Approved local places and upcoming events.','已審核的在地店家與即將舉行的活動。',id,'system','public','evergreen','{"version":1,"kind":"discover"}'::jsonb,'active','approved' FROM "city" ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
INSERT INTO "layer"(slug,title,title_chinese,description,description_chinese,city_id,owner_kind,audience,schedule,rule,lifecycle,review_status) SELECT 'today-'||slug,'Today in '||name,'今天的'||name,'Events happening today and editorial food picks. Updates every day.','今天的活動與精選美食，每天自動更新。',id,'system','public','rolling_today','{"version":1,"kind":"today"}'::jsonb,'active','approved' FROM "city" ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
INSERT INTO "layer"(slug,title,title_chinese,description,description_chinese,city_id,owner_kind,audience,schedule,rule,lifecycle,review_status) SELECT 'weekend-'||slug,'This weekend','本週末','Events from Saturday through Sunday. Updates every week.','週六到週日的活動，每週自動更新。',id,'system','public','evergreen','{"version":1,"kind":"weekend"}'::jsonb,'active','approved' FROM "city" ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
INSERT INTO "layer"(slug,title,title_chinese,description,description_chinese,city_id,owner_kind,audience,schedule,rule,lifecycle,review_status) SELECT 'food-'||slug,'Taiwanese food favorites','台灣人的美食愛店','Restaurants, bakeries and tea shops recommended by neighbors.','鄰居推薦的餐廳、麵包店與茶飲店。',id,'system','public','evergreen','{"version":1,"kind":"food"}'::jsonb,'active','approved' FROM "city" ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
INSERT INTO "layer"(slug,title,title_chinese,description,description_chinese,city_id,owner_kind,audience,schedule,rule,lifecycle,review_status) SELECT 'community-'||slug,'Community gatherings','社群聚會','Social, student, family and professional meetups.','社交、學生、家庭與職涯聚會。',id,'system','public','evergreen','{"version":1,"kind":"community"}'::jsonb,'active','approved' FROM "city" ON CONFLICT (slug) DO NOTHING;
