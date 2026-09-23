CREATE TABLE "extraction_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_slug" text NOT NULL,
	"kind" text NOT NULL,
	"source_label" text NOT NULL,
	"url" text NOT NULL,
	"neighborhood" text DEFAULT '' NOT NULL,
	"permission_note" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text DEFAULT '' NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_page_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "extraction_page" ADD CONSTRAINT "extraction_page_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;