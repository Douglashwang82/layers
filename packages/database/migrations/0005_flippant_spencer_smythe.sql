CREATE TABLE "generated_feed" (
	"slug" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source_label" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
