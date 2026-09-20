CREATE TABLE "content_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"proposed" jsonb NOT NULL,
	"base_updated_at" timestamp with time zone,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_field_lock" (
	"kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_field_lock_kind_entity_id_field_pk" PRIMARY KEY("kind","entity_id","field")
);
--> statement-breakpoint
CREATE TABLE "content_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"city_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"allow_auto_update" boolean DEFAULT false NOT NULL,
	"interval_hours" integer DEFAULT 24 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_source_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "entity_source" (
	"source_record_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_candidate" ADD CONSTRAINT "content_candidate_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_candidate" ADD CONSTRAINT "content_candidate_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_candidate" ADD CONSTRAINT "content_candidate_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_field_lock" ADD CONSTRAINT "content_field_lock_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revision" ADD CONSTRAINT "content_revision_candidate_id_content_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."content_candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revision" ADD CONSTRAINT "content_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_source" ADD CONSTRAINT "content_source_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_source" ADD CONSTRAINT "entity_source_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_source_id_content_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."content_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_record_identity" ON "source_record" USING btree ("source_id","external_id");