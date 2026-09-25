CREATE TABLE "place_provider_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_place_id" text NOT NULL,
	"state" text DEFAULT 'current' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_provider_reference_provider_check" CHECK ("place_provider_reference"."provider" = 'google'),
	CONSTRAINT "place_provider_reference_state_check" CHECK ("place_provider_reference"."state" IN ('current', 'superseded')),
	CONSTRAINT "place_provider_reference_id_length" CHECK (char_length("place_provider_reference"."provider_place_id") BETWEEN 1 AND 512)
);
--> statement-breakpoint
CREATE TABLE "place_subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_place_id" uuid,
	"city_id" uuid,
	"city_review_status" text DEFAULT 'unreviewed' NOT NULL,
	"city_reviewed_by" uuid,
	"city_reviewed_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_subject_catalog_place_id_unique" UNIQUE("catalog_place_id"),
	CONSTRAINT "place_subject_city_review_status_check" CHECK ("place_subject"."city_review_status" IN ('unreviewed', 'approved')),
	CONSTRAINT "place_subject_status_check" CHECK ("place_subject"."status" IN ('active', 'hidden', 'deleted')),
	CONSTRAINT "place_subject_approved_city_check" CHECK ("place_subject"."city_review_status" = 'unreviewed' OR "place_subject"."city_id" IS NOT NULL),
	CONSTRAINT "place_subject_revision_check" CHECK ("place_subject"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "saved_place_subject" (
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_place_subject_user_id_subject_id_pk" PRIMARY KEY("user_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "layer_item" DROP CONSTRAINT "layer_item_one_entity";--> statement-breakpoint
ALTER TABLE "layer_item" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "place_provider_reference" ADD CONSTRAINT "place_provider_reference_subject_id_place_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."place_subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_subject" ADD CONSTRAINT "place_subject_catalog_place_id_place_id_fk" FOREIGN KEY ("catalog_place_id") REFERENCES "public"."place"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_subject" ADD CONSTRAINT "place_subject_city_id_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."city"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_subject" ADD CONSTRAINT "place_subject_city_reviewed_by_user_id_fk" FOREIGN KEY ("city_reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_place_subject" ADD CONSTRAINT "saved_place_subject_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_place_subject" ADD CONSTRAINT "saved_place_subject_subject_id_place_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."place_subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "place_provider_reference_identity" ON "place_provider_reference" USING btree ("provider","provider_place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "place_provider_reference_current" ON "place_provider_reference" USING btree ("subject_id","provider") WHERE "place_provider_reference"."state" = 'current';--> statement-breakpoint
CREATE INDEX "place_provider_reference_subject_idx" ON "place_provider_reference" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "place_subject_city_review_idx" ON "place_subject" USING btree ("city_review_status","created_at");--> statement-breakpoint
CREATE INDEX "saved_place_subject_subject_idx" ON "saved_place_subject" USING btree ("subject_id");--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_subject_id_place_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."place_subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "layer_item_subject_unique" ON "layer_item" USING btree ("layer_id","subject_id") WHERE "layer_item"."subject_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "layer_item_subject_idx" ON "layer_item" USING btree ("subject_id");--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_one_entity" CHECK (num_nonnulls("layer_item"."place_id", "layer_item"."event_id", "layer_item"."content_id", "layer_item"."subject_id") = 1);