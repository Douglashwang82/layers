CREATE TABLE "restaurant_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"run_id" uuid,
	"run_date" date NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"expected_pick_id" uuid,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_job_kind_check" CHECK ("restaurant_job"."kind" IN ('prepare','publish')),
	CONSTRAINT "restaurant_job_status_check" CHECK ("restaurant_job"."status" IN ('queued','running','succeeded','failed'))
);
--> statement-breakpoint
ALTER TABLE "restaurant_job" ADD CONSTRAINT "restaurant_job_area_id_restaurant_discovery_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."restaurant_discovery_area"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_job" ADD CONSTRAINT "restaurant_job_run_id_daily_pick_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."daily_pick_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_job" ADD CONSTRAINT "restaurant_job_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_job" ADD CONSTRAINT "restaurant_job_expected_pick_id_daily_pick_id_fk" FOREIGN KEY ("expected_pick_id") REFERENCES "public"."daily_pick"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_job_pending_unique" ON "restaurant_job" USING btree ("area_id","run_date","kind") WHERE "restaurant_job"."status" IN ('queued','running');