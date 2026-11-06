CREATE TABLE "layer_suggestion_run" (
	"user_id" uuid NOT NULL,
	"snapshot_hash" text NOT NULL,
	"locale" text NOT NULL,
	"suggestions" jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "layer_suggestion_run_user_id_snapshot_hash_pk" PRIMARY KEY("user_id","snapshot_hash"),
	CONSTRAINT "layer_suggestion_run_hash_check" CHECK (char_length("layer_suggestion_run"."snapshot_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "layer_suggestion_run" ADD CONSTRAINT "layer_suggestion_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layer_suggestion_run_expires_idx" ON "layer_suggestion_run" USING btree ("expires_at");