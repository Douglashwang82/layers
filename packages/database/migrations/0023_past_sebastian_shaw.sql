CREATE TABLE "layer_item_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layer_item_id" uuid NOT NULL,
	"title" text NOT NULL,
	"title_chinese" text DEFAULT '' NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layer_item_event_time_check" CHECK ("layer_item_event"."start_time" <= "layer_item_event"."end_time"),
	CONSTRAINT "layer_item_event_status_check" CHECK ("layer_item_event"."status" IN ('active', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "layer_item_event" ADD CONSTRAINT "layer_item_event_layer_item_id_layer_item_id_fk" FOREIGN KEY ("layer_item_id") REFERENCES "public"."layer_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_item_event" ADD CONSTRAINT "layer_item_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_item_event" ADD CONSTRAINT "layer_item_event_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layer_item_event_item_idx" ON "layer_item_event" USING btree ("layer_item_id","start_time");