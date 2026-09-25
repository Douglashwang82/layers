CREATE TABLE "place_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_kind" text NOT NULL,
	"layer_id" uuid,
	"group_id" uuid,
	"stars" integer,
	"body" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"deletion_source" text,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_review_scope_check" CHECK (("place_review"."scope_kind" = 'layer' AND "place_review"."layer_id" IS NOT NULL AND "place_review"."group_id" IS NULL) OR ("place_review"."scope_kind" = 'group' AND "place_review"."group_id" IS NOT NULL AND "place_review"."layer_id" IS NULL)),
	CONSTRAINT "place_review_stars_check" CHECK ("place_review"."stars" IS NULL OR "place_review"."stars" BETWEEN 1 AND 5),
	CONSTRAINT "place_review_body_length" CHECK (char_length("place_review"."body") <= 2000),
	CONSTRAINT "place_review_not_empty" CHECK ("place_review"."stars" IS NOT NULL OR char_length(btrim("place_review"."body")) > 0),
	CONSTRAINT "place_review_status_check" CHECK ("place_review"."status" IN ('pending', 'approved', 'rejected', 'hidden', 'deleted')),
	CONSTRAINT "place_review_deletion_check" CHECK (("place_review"."status" = 'deleted') = ("place_review"."deletion_source" IS NOT NULL)),
	CONSTRAINT "place_review_revision_check" CHECK ("place_review"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "place_review_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"actor_id" uuid,
	"change_kind" text NOT NULL,
	"stars" integer,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "entity_revision" integer;--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_subject_id_place_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."place_subject"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_layer_id_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_moderated_by_user_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_review_revision" ADD CONSTRAINT "place_review_revision_review_id_place_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."place_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_review_revision" ADD CONSTRAINT "place_review_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "place_review_layer_unique" ON "place_review" USING btree ("subject_id","user_id","layer_id") WHERE "place_review"."layer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "place_review_group_unique" ON "place_review" USING btree ("subject_id","user_id","group_id") WHERE "place_review"."group_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "place_review_layer_idx" ON "place_review" USING btree ("layer_id","subject_id","status","created_at");--> statement-breakpoint
CREATE INDEX "place_review_group_idx" ON "place_review" USING btree ("group_id","subject_id","status","created_at");--> statement-breakpoint
CREATE INDEX "place_review_user_idx" ON "place_review" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "place_review_subject_idx" ON "place_review" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "place_review_revision_identity" ON "place_review_revision" USING btree ("review_id","revision");