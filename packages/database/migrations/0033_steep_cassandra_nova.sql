ALTER TABLE "layer_item" ADD COLUMN "marker_image_id" uuid;--> statement-breakpoint
ALTER TABLE "layer_item" ADD CONSTRAINT "layer_item_marker_image_id_image_id_fk" FOREIGN KEY ("marker_image_id") REFERENCES "public"."image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layer_item_marker_image_idx" ON "layer_item" USING btree ("marker_image_id");