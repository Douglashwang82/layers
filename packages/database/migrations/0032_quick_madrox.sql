CREATE TABLE "messaging_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id_hash" text NOT NULL,
	"status" text DEFAULT 'pending_confirm' NOT NULL,
	"default_layer_id" uuid,
	"inbox_layer_id" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_link_channel_check" CHECK ("messaging_link"."channel" IN ('line','instagram')),
	CONSTRAINT "messaging_link_status_check" CHECK ("messaging_link"."status" IN ('active','pending_confirm'))
);
--> statement-breakpoint
CREATE TABLE "messaging_link_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_link_attempt_channel_check" CHECK ("messaging_link_attempt"."channel" IN ('line','instagram'))
);
--> statement-breakpoint
CREATE TABLE "messaging_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"channel" text NOT NULL,
	"event_id" text NOT NULL,
	"source_url" text,
	"layer_id" uuid,
	"outcome" text DEFAULT 'received' NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_receipt_channel_check" CHECK ("messaging_receipt"."channel" IN ('line','instagram'))
);
--> statement-breakpoint
ALTER TABLE "messaging_link" ADD CONSTRAINT "messaging_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_link" ADD CONSTRAINT "messaging_link_default_layer_id_layer_id_fk" FOREIGN KEY ("default_layer_id") REFERENCES "public"."layer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_link" ADD CONSTRAINT "messaging_link_inbox_layer_id_layer_id_fk" FOREIGN KEY ("inbox_layer_id") REFERENCES "public"."layer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_link_attempt" ADD CONSTRAINT "messaging_link_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_receipt" ADD CONSTRAINT "messaging_receipt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_receipt" ADD CONSTRAINT "messaging_receipt_layer_id_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_link_external_unique" ON "messaging_link" USING btree ("channel","external_id_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_link_user_channel_unique" ON "messaging_link" USING btree ("user_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_link_attempt_secret_unique" ON "messaging_link_attempt" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "messaging_link_attempt_user_idx" ON "messaging_link_attempt" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_receipt_event_unique" ON "messaging_receipt" USING btree ("channel","event_id");--> statement-breakpoint
CREATE INDEX "messaging_receipt_user_idx" ON "messaging_receipt" USING btree ("user_id","received_at");