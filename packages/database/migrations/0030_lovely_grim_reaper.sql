ALTER TABLE "place_review" DROP CONSTRAINT "place_review_target_check";--> statement-breakpoint
ALTER TABLE "place_review" DROP CONSTRAINT "place_review_layer_item_id_layer_item_id_fk";
--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_layer_item_id_layer_item_id_fk" FOREIGN KEY ("layer_item_id") REFERENCES "public"."layer_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_review" ADD CONSTRAINT "place_review_target_check" CHECK ((("place_review"."subject_id" IS NOT NULL) <> ("place_review"."layer_item_id" IS NOT NULL)) OR ("place_review"."subject_id" IS NULL AND "place_review"."layer_item_id" IS NULL AND "place_review"."status" = 'deleted'));