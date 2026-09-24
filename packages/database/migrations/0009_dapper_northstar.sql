CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"recipient" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"payload_key_version" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"provider_message_id" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "membership_admission" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"invitation_id" uuid,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	CONSTRAINT "membership_admission_invitation_id_unique" UNIQUE("invitation_id"),
	CONSTRAINT "membership_admission_invitation_required" CHECK ("membership_admission"."source" = 'legacy' OR "membership_admission"."invitation_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "membership_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"nomination_id" uuid,
	"invitation_id" uuid,
	"target_user_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_batch_capacity_positive" CHECK ("membership_batch"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "membership_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nomination_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"delivery" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"redeemed_by" uuid,
	"redeemed_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_invitation_nomination_id_unique" UNIQUE("nomination_id"),
	CONSTRAINT "membership_invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "membership_join_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_hash" text NOT NULL,
	"invitation_id" uuid NOT NULL,
	"token_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_join_context_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE TABLE "membership_nomination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" text NOT NULL,
	"nominator_id" uuid,
	"source" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_nomination_nominator_required" CHECK ("membership_nomination"."source" = 'operator_bootstrap' OR "membership_nomination"."nominator_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "membership_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result_entity_id" uuid,
	"result_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_reviewer" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "membership_admission" ADD CONSTRAINT "membership_admission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_admission" ADD CONSTRAINT "membership_admission_invitation_id_membership_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."membership_invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_audit" ADD CONSTRAINT "membership_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_audit" ADD CONSTRAINT "membership_audit_nomination_id_membership_nomination_id_fk" FOREIGN KEY ("nomination_id") REFERENCES "public"."membership_nomination"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_audit" ADD CONSTRAINT "membership_audit_invitation_id_membership_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."membership_invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_audit" ADD CONSTRAINT "membership_audit_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_batch" ADD CONSTRAINT "membership_batch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invitation" ADD CONSTRAINT "membership_invitation_nomination_id_membership_nomination_id_fk" FOREIGN KEY ("nomination_id") REFERENCES "public"."membership_nomination"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invitation" ADD CONSTRAINT "membership_invitation_batch_id_membership_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."membership_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invitation" ADD CONSTRAINT "membership_invitation_redeemed_by_user_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invitation" ADD CONSTRAINT "membership_invitation_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_join_context" ADD CONSTRAINT "membership_join_context_invitation_id_membership_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."membership_invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_nomination" ADD CONSTRAINT "membership_nomination_nominator_id_user_id_fk" FOREIGN KEY ("nominator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_nomination" ADD CONSTRAINT "membership_nomination_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_request" ADD CONSTRAINT "membership_request_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_reviewer" ADD CONSTRAINT "membership_reviewer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_reviewer" ADD CONSTRAINT "membership_reviewer_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_reviewer" ADD CONSTRAINT "membership_reviewer_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_next_attempt_idx" ON "mail_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "membership_audit_nomination_idx" ON "membership_audit" USING btree ("nomination_id");--> statement-breakpoint
CREATE INDEX "membership_audit_invitation_idx" ON "membership_audit" USING btree ("invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_batch_single_open" ON "membership_batch" USING btree ("status") WHERE "membership_batch"."status" = 'open';--> statement-breakpoint
CREATE INDEX "membership_invitation_batch_status_idx" ON "membership_invitation" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "membership_join_context_invitation_idx" ON "membership_join_context" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "membership_nomination_email_idx" ON "membership_nomination" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_nomination_open_email" ON "membership_nomination" USING btree ("email_normalized") WHERE "membership_nomination"."status" IN ('pending_review', 'needs_info', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "membership_request_identity" ON "membership_request" USING btree ("actor_id","operation","idempotency_key");