CREATE TABLE "external_api_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"method" text NOT NULL,
	"host" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"status" integer,
	"ok" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "external_api_call_created_idx" ON "external_api_call" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "external_api_call_provider_idx" ON "external_api_call" USING btree ("provider","created_at");