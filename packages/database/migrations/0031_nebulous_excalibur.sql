CREATE TABLE "layer_share_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "layer_share_link_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "group_invite" ADD COLUMN "membership_invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "layer_share_link" ADD CONSTRAINT "layer_share_link_layer_id_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_share_link" ADD CONSTRAINT "layer_share_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_share_link" ADD CONSTRAINT "layer_share_link_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "layer_share_link_one_active" ON "layer_share_link" USING btree ("layer_id") WHERE "layer_share_link"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "group_invite" ADD CONSTRAINT "group_invite_membership_invitation_id_membership_invitation_id_fk" FOREIGN KEY ("membership_invitation_id") REFERENCES "public"."membership_invitation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_invite_membership_invitation_idx" ON "group_invite" USING btree ("membership_invitation_id");