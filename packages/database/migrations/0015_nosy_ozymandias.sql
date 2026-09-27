CREATE TABLE "custom_place" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"owner_group_id" uuid,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_chinese" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"location_status" text DEFAULT 'unspecified' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"location" geometry(point),
	"category_id" uuid,
	"website" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"catalog_place_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_place_one_owner" CHECK (num_nonnulls("custom_place"."owner_user_id", "custom_place"."owner_group_id") = 1),
	CONSTRAINT "custom_place_location_check" CHECK (("custom_place"."location_status" = 'unspecified') = ("custom_place"."latitude" IS NULL AND "custom_place"."longitude" IS NULL) AND num_nonnulls("custom_place"."latitude", "custom_place"."longitude") <> 1),
	CONSTRAINT "custom_place_status_check" CHECK ("custom_place"."status" IN ('active', 'hidden', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "layer_item" DROP CONSTRAINT "layer_item_one_entity";--> statement-breakpoint
ALTER TABLE "layer_item" ADD COLUMN "custom_place_id" uuid;--> statement-breakpoint
ALTER TABLE "custom_place" ADD CONSTRAINT "custom_place_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_place" ADD CONSTRAINT "custom_place_owner_group_id_group_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_place" ADD CONSTRAINT "custom_place_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_place" ADD CONSTRAINT "custom_place_category_id_place_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."place_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_place" ADD CONSTRAINT "custom_place_catalog_place_id_place_id_fk" FOREIGN KEY ("catalog_place_id") REFERENCES "public"."place"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_place" ADD CONSTRAINT "custom_place_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_place_owner_user_idx" ON "custom_place" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "custom_place_owner_group_idx" ON "custom_place" USING btree ("owner_group_id");--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_custom_place_id_custom_place_id_fk" FOREIGN KEY ("custom_place_id") REFERENCES "public"."custom_place"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "layer_item_custom_place_unique" ON "layer_item" USING btree ("layer_id","custom_place_id") WHERE "layer_item"."custom_place_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "layer_item_custom_place_idx" ON "layer_item" USING btree ("custom_place_id");--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_one_entity" CHECK (num_nonnulls("layer_item"."place_id", "layer_item"."event_id", "layer_item"."content_id", "layer_item"."subject_id", "layer_item"."custom_place_id") = 1);