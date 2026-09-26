CREATE TABLE "daily_pick" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"pick_date" date NOT NULL,
	"place_id" uuid NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"selection_kind" text NOT NULL,
	"selection_version" integer NOT NULL,
	"description" text NOT NULL,
	"description_chinese" text DEFAULT '' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_text" text NOT NULL,
	"reason_text_chinese" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"replaces_id" uuid,
	"created_by" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"withdrawal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_pick_status_check" CHECK ("daily_pick"."status" IN ('published', 'withdrawn')),
	CONSTRAINT "daily_pick_selection_kind_check" CHECK ("daily_pick"."selection_kind" IN ('automatic', 'editorial')),
	CONSTRAINT "daily_pick_withdrawal_check" CHECK (("daily_pick"."status" = 'withdrawn') = ("daily_pick"."withdrawn_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "daily_pick" ADD CONSTRAINT "daily_pick_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD CONSTRAINT "daily_pick_place_id_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD CONSTRAINT "daily_pick_replaces_id_daily_pick_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."daily_pick"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD CONSTRAINT "daily_pick_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD CONSTRAINT "daily_pick_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pick_city_date_published" ON "daily_pick" USING btree ("city_id","pick_date") WHERE "daily_pick"."status" = 'published';--> statement-breakpoint
CREATE INDEX "daily_pick_city_date_idx" ON "daily_pick" USING btree ("city_id","pick_date");--> statement-breakpoint
CREATE INDEX "daily_pick_place_idx" ON "daily_pick" USING btree ("place_id");--> statement-breakpoint
INSERT INTO "layer"(slug,title,title_chinese,description,description_chinese,city_id,owner_kind,audience,schedule,rule,lifecycle,review_status) SELECT 'daily-pick-'||slug,'Daily Pick','每日精選','One place to discover each day, with a little context on why it''s worth exploring.','每天介紹一個值得探索的地點，並說明推薦的原因。',id,'system','public','rolling_today','{"version":1,"kind":"daily_pick"}'::jsonb,'active','approved' FROM "city" ON CONFLICT (slug) DO NOTHING;