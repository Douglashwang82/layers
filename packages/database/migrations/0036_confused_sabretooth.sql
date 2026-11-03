ALTER TABLE "layer_collection" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "title_chinese" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "description_chinese" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "city_id" uuid;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "depth" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "audience" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "review_status" text DEFAULT 'unsubmitted' NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "lifecycle" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "user_map_preference" ADD COLUMN "active_collections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "layer_collection" SET "slug" = 'folder-' || left(replace("id"::text, '-', ''), 10);--> statement-breakpoint
UPDATE "layer_collection" SET "audience" = 'group' WHERE "owner_group_id" IS NOT NULL;--> statement-breakpoint
-- city_id backfill order: first member layer's city, owner group's city, owner user's home city, then houston.
UPDATE "layer_collection" c SET "city_id" = (
  SELECT l."city_id" FROM "layer_collection_member" m JOIN "layer" l ON l."id" = m."layer_id"
  WHERE m."collection_id" = c."id" ORDER BY m."position", l."id" LIMIT 1
);--> statement-breakpoint
UPDATE "layer_collection" c SET "city_id" = g."city_id" FROM "group" g
  WHERE c."city_id" IS NULL AND c."owner_group_id" = g."id";--> statement-breakpoint
UPDATE "layer_collection" c SET "city_id" = u."home_city_id" FROM "user" u
  WHERE c."city_id" IS NULL AND c."owner_user_id" = u."id" AND u."home_city_id" IS NOT NULL;--> statement-breakpoint
UPDATE "layer_collection" SET "city_id" = (SELECT "id" FROM "city" WHERE "slug" = 'houston')
  WHERE "city_id" IS NULL;--> statement-breakpoint
-- Only rows that still have no city (no houston row exists) are removed; folders are never deleted otherwise.
DELETE FROM "layer_collection" WHERE "city_id" IS NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ALTER COLUMN "city_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD CONSTRAINT "layer_collection_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD CONSTRAINT "layer_collection_parent_id_layer_collection_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."layer_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD CONSTRAINT "layer_collection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_collection" ADD CONSTRAINT "layer_collection_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layer_collection_parent_position_idx" ON "layer_collection" USING btree ("parent_id","position");--> statement-breakpoint
CREATE INDEX "layer_collection_city_idx" ON "layer_collection" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "layer_collection_owner_user_idx" ON "layer_collection" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "layer_collection_owner_group_idx" ON "layer_collection" USING btree ("owner_group_id");--> statement-breakpoint
CREATE INDEX "layer_collection_member_layer_idx" ON "layer_collection_member" USING btree ("layer_id");--> statement-breakpoint
ALTER TABLE "layer_collection" ADD CONSTRAINT "layer_collection_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "layer_collection" ADD CONSTRAINT "layer_collection_depth_check" CHECK ("layer_collection"."depth" BETWEEN 1 AND 3);