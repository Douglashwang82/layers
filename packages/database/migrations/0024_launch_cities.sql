-- Launch cities: Taipei, Houston and Tokyo (packages/shared/src/cities.ts).
-- Houston already exists (seeded); add Taipei and Tokyo with their system
-- layers, and give Houston's system layers its Chinese name. Idempotent.
INSERT INTO "city"(id,slug,name,region,country,timezone,latitude,longitude) VALUES
  ('00000000-0000-4000-8000-000000001002','taipei','Taipei','Taipei','Taiwan','Asia/Taipei',25.033,121.5654),
  ('00000000-0000-4000-8000-000000001003','tokyo','Tokyo','Tokyo','Japan','Asia/Tokyo',35.6762,139.6503)
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
INSERT INTO "layer"(slug,title,title_chinese,description,description_chinese,city_id,owner_kind,audience,schedule,rule,lifecycle,review_status)
SELECT d.kind || '-' || c.slug,
  CASE d.kind WHEN 'discover' THEN 'Discover ' || c.name WHEN 'today' THEN 'Today in ' || c.name ELSE d.title END,
  CASE d.kind WHEN 'discover' THEN '探索' || n.zh WHEN 'today' THEN '今天的' || n.zh ELSE d.title_chinese END,
  d.description, d.description_chinese, c.id, 'system', 'public', d.schedule,
  jsonb_build_object('version', 1, 'kind', d.rule_kind), 'active', 'approved'
FROM "city" c
JOIN (VALUES ('taipei','台北'),('tokyo','東京')) AS n(slug, zh) ON n.slug = c.slug
CROSS JOIN (VALUES
  ('discover','discover','','','Approved local places and upcoming events.','已審核的在地店家與即將舉行的活動。','evergreen'),
  ('today','today','','','Events happening today and editorial food picks. Updates every day.','今天的活動與精選美食，每天自動更新。','rolling_today'),
  ('daily-pick','daily_pick','Daily Pick','每日精選','One place to discover each day, with a little context on why it''s worth exploring.','每天介紹一個值得探索的地點，並說明推薦的原因。','rolling_today'),
  ('weekend','weekend','This weekend','本週末','Events from Saturday through Sunday. Updates every week.','週六到週日的活動，每週自動更新。','evergreen'),
  ('food','food','Local food favorites','在地美食愛店','Restaurants, bakeries and tea shops recommended by neighbors.','鄰居推薦的餐廳、麵包店與茶飲店。','evergreen'),
  ('community','community','Community gatherings','社群聚會','Social, student, family and professional meetups.','社交、學生、家庭與職涯聚會。','evergreen')
) AS d(kind, rule_kind, title, title_chinese, description, description_chinese, schedule)
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
UPDATE "layer" SET title_chinese = '探索休士頓' WHERE slug = 'discover-houston' AND title_chinese = '探索Houston';
--> statement-breakpoint
UPDATE "layer" SET title_chinese = '今天的休士頓' WHERE slug = 'today-houston' AND title_chinese = '今天的Houston';
