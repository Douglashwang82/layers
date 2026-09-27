CREATE TABLE "daily_pick_layer_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pick_id" uuid NOT NULL,
	"layer_id" uuid NOT NULL,
	"layer_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_pick_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"config_version" integer NOT NULL,
	"rules_config" jsonb NOT NULL,
	"evaluated_count" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"copy_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"final_pick_id" uuid,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_pick_run_attempt_check" CHECK ("daily_pick_run"."attempt" >= 1),
	CONSTRAINT "daily_pick_run_status_check" CHECK ("daily_pick_run"."status" IN ('queued', 'discovering', 'evaluating', 'writing', 'ready_for_review', 'ready_to_publish', 'published', 'empty', 'partial', 'failed', 'superseded', 'canceled')),
	CONSTRAINT "daily_pick_run_copy_status_check" CHECK ("daily_pick_run"."copy_status" IN ('pending', 'approved', 'rejected', 'not_needed'))
);
--> statement-breakpoint
CREATE TABLE "daily_pick_run_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"base_rank" integer NOT NULL,
	"eligible_rank" integer,
	"report_position" integer NOT NULL,
	"decision" text NOT NULL,
	"score" double precision,
	"primary_reason_code" text NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_pick_run_candidate_decision_check" CHECK ("daily_pick_run_candidate"."decision" IN ('picked', 'eligible_not_picked', 'excluded'))
);
--> statement-breakpoint
CREATE TABLE "restaurant_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"state" text DEFAULT 'discovered' NOT NULL,
	"food_type" text,
	"food_type_version" integer,
	"food_type_source" text,
	"excluded_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_candidate_state_check" CHECK ("restaurant_candidate"."state" IN ('discovered', 'reviewing', 'approved', 'excluded')),
	CONSTRAINT "restaurant_candidate_food_source_check" CHECK ("restaurant_candidate"."food_type_source" IS NULL OR "restaurant_candidate"."food_type_source" IN ('llm_suggested', 'moderator'))
);
--> statement-breakpoint
CREATE TABLE "restaurant_copy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"run_id" uuid,
	"en_sentences" jsonb NOT NULL,
	"zh_sentences" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"model_version" text NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_copy_review_status_check" CHECK ("restaurant_copy"."review_status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "restaurant_discovery_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_slug" text NOT NULL,
	"layer_slug" text NOT NULL,
	"timezone" text NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_discovery_area_config_version_check" CHECK ("restaurant_discovery_area"."config_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "restaurant_discovery_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"request_count" integer DEFAULT 0 NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_discovery_run_status_check" CHECK ("restaurant_discovery_run"."status" IN ('queued', 'running', 'success', 'partial', 'failed')),
	CONSTRAINT "restaurant_discovery_run_attempt_check" CHECK ("restaurant_discovery_run"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "restaurant_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"label" text NOT NULL,
	"source_url" text,
	"approved_for_copy" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_evidence_label_length" CHECK (char_length("restaurant_evidence"."label") BETWEEN 1 AND 200),
	CONSTRAINT "restaurant_evidence_revision_check" CHECK ("restaurant_evidence"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "daily_pick" ALTER COLUMN "place_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD COLUMN "food_type" text;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD COLUMN "food_type_version" integer;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD COLUMN "copy_id" uuid;--> statement-breakpoint
ALTER TABLE "daily_pick_layer_membership" ADD CONSTRAINT "daily_pick_layer_membership_pick_id_daily_pick_id_fk" FOREIGN KEY ("pick_id") REFERENCES "public"."daily_pick"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick_layer_membership" ADD CONSTRAINT "daily_pick_layer_membership_layer_id_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick_layer_membership" ADD CONSTRAINT "daily_pick_layer_membership_layer_item_id_layer_item_id_fk" FOREIGN KEY ("layer_item_id") REFERENCES "public"."layer_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick_run" ADD CONSTRAINT "daily_pick_run_area_id_restaurant_discovery_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."restaurant_discovery_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick_run" ADD CONSTRAINT "daily_pick_run_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick_run" ADD CONSTRAINT "daily_pick_run_final_pick_id_daily_pick_id_fk" FOREIGN KEY ("final_pick_id") REFERENCES "public"."daily_pick"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick_run_candidate" ADD CONSTRAINT "daily_pick_run_candidate_run_id_daily_pick_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."daily_pick_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick_run_candidate" ADD CONSTRAINT "daily_pick_run_candidate_subject_id_place_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."place_subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_candidate" ADD CONSTRAINT "restaurant_candidate_area_id_restaurant_discovery_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."restaurant_discovery_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_candidate" ADD CONSTRAINT "restaurant_candidate_subject_id_place_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."place_subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_candidate" ADD CONSTRAINT "restaurant_candidate_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_copy" ADD CONSTRAINT "restaurant_copy_candidate_id_restaurant_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."restaurant_candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_copy" ADD CONSTRAINT "restaurant_copy_run_id_daily_pick_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."daily_pick_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_copy" ADD CONSTRAINT "restaurant_copy_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_discovery_run" ADD CONSTRAINT "restaurant_discovery_run_area_id_restaurant_discovery_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."restaurant_discovery_area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_evidence" ADD CONSTRAINT "restaurant_evidence_candidate_id_restaurant_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."restaurant_candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_evidence" ADD CONSTRAINT "restaurant_evidence_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pick_layer_membership_pick_unique" ON "daily_pick_layer_membership" USING btree ("pick_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pick_layer_membership_item_unique" ON "daily_pick_layer_membership" USING btree ("layer_item_id");--> statement-breakpoint
CREATE INDEX "daily_pick_layer_membership_layer_idx" ON "daily_pick_layer_membership" USING btree ("layer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pick_run_identity" ON "daily_pick_run" USING btree ("area_id","run_date","attempt");--> statement-breakpoint
CREATE INDEX "daily_pick_run_area_date_idx" ON "daily_pick_run" USING btree ("area_id","run_date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pick_run_candidate_identity" ON "daily_pick_run_candidate" USING btree ("run_id","subject_id");--> statement-breakpoint
CREATE INDEX "daily_pick_run_candidate_report_idx" ON "daily_pick_run_candidate" USING btree ("run_id","report_position");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_candidate_area_subject_unique" ON "restaurant_candidate" USING btree ("area_id","subject_id");--> statement-breakpoint
CREATE INDEX "restaurant_candidate_area_state_idx" ON "restaurant_candidate" USING btree ("area_id","state");--> statement-breakpoint
CREATE INDEX "restaurant_copy_candidate_idx" ON "restaurant_copy" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "restaurant_copy_run_idx" ON "restaurant_copy" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_discovery_area_city_unique" ON "restaurant_discovery_area" USING btree ("city_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_discovery_run_identity" ON "restaurant_discovery_run" USING btree ("area_id","run_date","attempt");--> statement-breakpoint
CREATE INDEX "restaurant_discovery_run_area_date_idx" ON "restaurant_discovery_run" USING btree ("area_id","run_date");--> statement-breakpoint
CREATE INDEX "restaurant_evidence_candidate_idx" ON "restaurant_evidence" USING btree ("candidate_id");--> statement-breakpoint
ALTER TABLE "daily_pick" ADD CONSTRAINT "daily_pick_subject_id_place_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."place_subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD CONSTRAINT "daily_pick_run_id_daily_pick_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."daily_pick_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pick" ADD CONSTRAINT "daily_pick_copy_id_restaurant_copy_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."restaurant_copy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_pick_subject_idx" ON "daily_pick" USING btree ("subject_id");--> statement-breakpoint
ALTER TABLE "daily_pick" ADD CONSTRAINT "daily_pick_identity_check" CHECK (num_nonnulls("daily_pick"."place_id", "daily_pick"."subject_id") >= 1);