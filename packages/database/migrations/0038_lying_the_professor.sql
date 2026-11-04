ALTER TABLE "trip" ADD COLUMN "base_item_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "start_kind" text DEFAULT 'base' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "start_item_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "end_kind" text DEFAULT 'base' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "end_item_id" uuid;--> statement-breakpoint
ALTER TABLE "trip" ADD CONSTRAINT "trip_base_item_id_layer_item_id_fk" FOREIGN KEY ("base_item_id") REFERENCES "public"."layer_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day" ADD CONSTRAINT "trip_day_start_item_id_layer_item_id_fk" FOREIGN KEY ("start_item_id") REFERENCES "public"."layer_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day" ADD CONSTRAINT "trip_day_end_item_id_layer_item_id_fk" FOREIGN KEY ("end_item_id") REFERENCES "public"."layer_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day" ADD CONSTRAINT "trip_day_start_kind_check" CHECK ("trip_day"."start_kind" IN ('base', 'first_stop', 'item'));--> statement-breakpoint
ALTER TABLE "trip_day" ADD CONSTRAINT "trip_day_end_kind_check" CHECK ("trip_day"."end_kind" IN ('base', 'last_stop', 'item'));