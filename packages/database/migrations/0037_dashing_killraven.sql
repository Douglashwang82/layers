CREATE TABLE "trip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"city_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"owner_group_id" uuid,
	"audience" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"stops_per_day" smallint DEFAULT 6 NOT NULL,
	"optimizer_version" smallint DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_owner_check" CHECK (("trip"."audience" = 'private' AND "trip"."owner_user_id" IS NOT NULL AND "trip"."owner_group_id" IS NULL) OR ("trip"."audience" = 'group' AND "trip"."owner_group_id" IS NOT NULL AND "trip"."owner_user_id" IS NULL)),
	CONSTRAINT "trip_dates_check" CHECK ("trip"."starts_on" <= "trip"."ends_on" AND "trip"."ends_on" - "trip"."starts_on" < 14),
	CONSTRAINT "trip_stops_per_day_check" CHECK ("trip"."stops_per_day" BETWEEN 2 AND 12),
	CONSTRAINT "trip_status_check" CHECK ("trip"."status" IN ('active', 'deleted')),
	CONSTRAINT "trip_title_check" CHECK (length("trip"."title") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "trip_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"order_mode" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_day_order_mode_check" CHECK ("trip_day"."order_mode" IN ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "trip_stop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"layer_item_id" uuid,
	"day_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"unscheduled_reason" text,
	"status" text DEFAULT 'active' NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_stop_status_check" CHECK ("trip_stop"."status" IN ('active', 'removed')),
	CONSTRAINT "trip_stop_reason_check" CHECK ("trip_stop"."unscheduled_reason" IS NULL OR "trip_stop"."unscheduled_reason" IN ('overflow', 'no_location', 'day_removed', 'user'))
);
--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_owner_group_id_group_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day" ADD CONSTRAINT "trip_day_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_layer_item_id_layer_item_id_fk" FOREIGN KEY ("layer_item_id") REFERENCES "public"."layer_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_day_id_trip_day_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."trip_day"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stop" ADD CONSTRAINT "trip_stop_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_owner_user_idx" ON "trip" USING btree ("owner_user_id") WHERE "trip"."status" = 'active';--> statement-breakpoint
CREATE INDEX "trip_owner_group_idx" ON "trip" USING btree ("owner_group_id") WHERE "trip"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "trip_day_date_unique" ON "trip_day" USING btree ("trip_id","on_date");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_stop_item_unique" ON "trip_stop" USING btree ("trip_id","layer_item_id") WHERE "trip_stop"."status" = 'active' AND "trip_stop"."layer_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "trip_stop_day_idx" ON "trip_stop" USING btree ("trip_id","day_id","position");--> statement-breakpoint
CREATE INDEX "trip_stop_item_idx" ON "trip_stop" USING btree ("layer_item_id");