ALTER TABLE "mail_outbox" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "first_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "sender" text;