DROP INDEX "daily_pick_layer_membership_item_unique";--> statement-breakpoint
ALTER TABLE "daily_pick_run_candidate" ADD COLUMN "fingerprint" text;--> statement-breakpoint
CREATE INDEX "daily_pick_layer_membership_item_idx" ON "daily_pick_layer_membership" USING btree ("layer_item_id");--> statement-breakpoint
-- Backfill canonical subjects for legacy (version 1) daily_pick rows so they
-- participate in version 2 restaurant-repeat history (loadCommittedFeatures).
-- Reuses an existing place_subject for the catalog place if one already
-- exists (e.g. created by resolveCatalogPlace when a member saved/reviewed
-- it); otherwise creates one, approved with the place's own city, matching
-- resolveCatalogPlace's existing convention. Never touches a row that
-- already has subject_id set, and never fabricates a food_type: legacy rows
-- keep food_type NULL, so they still consume the restaurant-repeat window
-- but correctly never produce a food_type_recent conflict.
INSERT INTO place_subject(catalog_place_id, city_id, city_review_status)
SELECT DISTINCT p.id, p.city_id, 'approved'
FROM daily_pick d
JOIN place p ON p.id = d.place_id
WHERE d.subject_id IS NULL AND d.place_id IS NOT NULL
ON CONFLICT (catalog_place_id) DO NOTHING;--> statement-breakpoint
UPDATE daily_pick d
SET subject_id = s.id
FROM place_subject s
WHERE d.subject_id IS NULL AND d.place_id IS NOT NULL AND s.catalog_place_id = d.place_id;