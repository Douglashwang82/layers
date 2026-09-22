# Database

PostgreSQL 17 + PostGIS 3.5 locally. The migration runner enables `postgis` before Drizzle migrations. Every domain entity uses UUID keys; join entities use composite keys. Auth session/account/verification are separate tables required by Better Auth. Timestamps are stored consistently on domain and relation tables.

| Area        | Tables / constraints                                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | user (unique email), account (unique provider/account), session (unique token), verification, auth_rate_limit                                                                                                                                                                    |
| Geography   | city (unique slug, IANA timezone); place/event geometry(Point,4326), latitude/longitude                                                                                                                                                                                          |
| Places      | place_category, place, place_recommendation (unique user/place), place_note                                                                                                                                                                                                      |
| Events      | event, event_rsvp (unique user/event), optional capacity                                                                                                                                                                                                                         |
| Communities | organization, organization_follow (unique user/organization), nullable claimed_by for future claims                                                                                                                                                                              |
| Products    | product (English/Chinese names, aliases), product_sighting (store/product/user/date/optional price/image)                                                                                                                                                                        |
| Personal    | saved_place, saved_event, saved_product, unique user/entity pairs                                                                                                                                                                                                                |
| Operations  | submission, image, moderation_action, analytics_event, rate_limit                                                                                                                                                                                                                |
| Layers      | layer (owner kind/user/group check constraint, audience, schedule with date check, allowlisted system rule, lifecycle, review status, revision), layer_item (exactly one of place/event/content, unique per layer/entity, position, validity), layer_follow, user_map_preference |
| Groups      | group, group_member (owner/editor/viewer), group_invite (email, token, expiry, accepted/revoked)                                                                                                                                                                                 |
| Content     | content_post (author, linked place/event, explicit location status, optional point/validity, moderation status), saved_content                                                                                                                                                   |

`name` maps to product `nameEnglish` and event `title` at the product concept level; a shared catalog projection keeps card/search rendering small. Product sightings don't imply inventory. Organization verification uses the same explicit verification enum as places and events. Seeded content remains UNVERIFIED, not falsely marked as real verified listings.

Indexes cover city/status places, city/start events, spatial geometry, recommendation uniqueness, product sighting recency, session lookup and user analytics dates. Foreign keys protect referenced entities. Recommendation votes remain one row per user/place when changed. RSVP capacity is enforced by an event row lock in the service rather than a count in the browser.

## Migration workflow

```sh
pnpm db:generate
# Review the generated SQL and snapshot before applying.
pnpm db:migrate
pnpm db:seed
```

Migrations are source-controlled. Do not use schema push in production. Take backups before schema changes. The seed is a single transaction and reuses deterministic UUIDs; it never truncates data. Demo account emails use the reserved `.invalid` domain and have no credential accounts.

All user notes, events, places and sightings start pending. Moderation actions store actor, entity, decision, reason and timestamps. Reports are submissions with a reason. Hidden/rejected/deleted entities are excluded by public repository queries. Deletion in the admin UI is soft deletion, not irreversible purging; add a documented retention and erasure process before collecting real production data.

Example future nearby query: `ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography, radiusMeters)`. No location history is stored. Current GiST geometry indexes support spatial operations on geometry; add a matching geography expression index if radius queries using that cast become common.
