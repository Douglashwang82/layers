ALTER TABLE "place_review" ALTER COLUMN "subject_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "place_review" ADD COLUMN "layer_item_id" uuid;--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_layer_item_id_layer_item_id_fk" FOREIGN KEY ("layer_item_id") REFERENCES "public"."layer_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "place_review_layer_item_unique" ON "place_review" USING btree ("layer_item_id","user_id") WHERE "place_review"."layer_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "place_review_layer_item_idx" ON "place_review" USING btree ("layer_item_id","status","created_at");--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_target_check" CHECK (("place_review"."subject_id" IS NOT NULL) <> ("place_review"."layer_item_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_item_scope_check" CHECK ("place_review"."layer_item_id" IS NULL OR "place_review"."scope_kind" = 'layer');