# HTTP API v1

Success: `{ "data": ... }`. Error: `{ "error": { "code": "...", "message": "..." } }`. Auth endpoints retain Better Auth's native response shape. Images/preferences use a message on errors. HTTP 400 validation, 401 unauthenticated, 403 forbidden, 404 missing/disabled, 409 capacity/ended conflicts, 413 oversized, 429 throttled, 500 unexpected failure.

Better Auth is mounted at `/api/auth/*`: `/sign-up/email`, `/sign-in/email`, `/sign-out`, `/get-session`, and social provider flows. Use its browser SDK or bearer plugin contract for native clients. All application mutations use the authenticated actor; body user IDs are ignored by schemas.

| Method         | Route                                                       | Behavior                                                                                            |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET            | `/api/v1/cities`                                            | Supported city IDs/slugs/names/timezones                                                            |
| GET            | `/api/v1/home?city=houston`                                 | Dynamic home sections                                                                               |
| GET            | `/api/v1/places`, `/events`, `/products`, `/organizations`  | Paginated catalog                                                                                   |
| GET            | `/api/v1/{kind}/{id-or-slug}`                               | Approved detail                                                                                     |
| GET            | `/api/v1/search?q=義美&city=houston`                        | Results grouped by kind                                                                             |
| GET            | `/api/v1/product-sightings/{productId}?city=houston`        | Approved sightings                                                                                  |
| GET            | `/api/v1/saved`                                             | Current user's saved groups                                                                         |
| POST           | `/api/v1/places/{uuid}/recommendation`                      | `{positive:boolean,note?:string}`                                                                   |
| POST / DELETE  | `/api/v1/events/{uuid}/rsvp`                                | Join/cancel, idempotent, capacity checked                                                           |
| POST / DELETE  | `/api/v1/organizations/{uuid}/follow`                       | Follow/unfollow                                                                                     |
| POST / DELETE  | `/api/v1/{places,events,products}/{uuid}/save`              | Save/unsave                                                                                         |
| POST           | `/api/v1/places`                                            | Submit pending place                                                                                |
| POST           | `/api/v1/events`                                            | Submit pending event                                                                                |
| POST           | `/api/v1/product-sightings`                                 | Submit pending report                                                                               |
| POST           | `/api/v1/reports`                                           | `{entityType,entityId,reason}`                                                                      |
| POST           | `/api/v1/images`                                            | Multipart `image`, authenticated, max 5 MB                                                          |
| PATCH          | `/api/v1/profile`                                           | `{name,bio,preferredLanguage,homeCityId}`                                                           |
| POST           | `/api/v1/preferences`                                       | Guest city selection: `{city:slug}`                                                                 |
| GET / POST     | `/api/v1/admin`                                             | Pending queue / moderation decision                                                                 |
| PATCH          | `/api/v1/admin/{kind}/{uuid}`                               | Edit common catalog fields                                                                          |
| GET            | `/api/v1/map`                                               | Validated layer/filter/area query: items, per-layer availability and counts, mapped/unmapped totals |
| GET            | `/api/v1/map/results?page=`                                 | Paginated rows over the same query contract                                                         |
| GET            | `/api/v1/map/item?key=place:uuid`                           | Selected item detail, action state and editable layers                                              |
| POST           | `/api/v1/map/preference`                                    | `{layers:[slug],view}` authorized active layers                                                     |
| GET            | `/api/v1/layers?scope=discover\|following\|mine\|groups&q=` | Authorized layer summaries by library scope                                                         |
| GET / POST     | `/api/v1/layers`, `/api/v1/layers/{id-or-slug}`             | Layer definition/preview; create (private or group default)                                         |
| PATCH / DELETE | `/api/v1/layers/{id}`                                       | Version-checked metadata/lifecycle/order; owner delete                                              |
| POST / DELETE  | `/api/v1/layers/{id}/items`                                 | Idempotent add (`{key,note?}`) / remove (`?key=`) of typed references                               |
| POST / DELETE  | `/api/v1/layers/{id}/follow`                                | Follow/unfollow independently of applying                                                           |
| POST / DELETE  | `/api/v1/layers/{id}/publish`                               | Request reviewed publication / make private                                                         |
| GET / POST     | `/api/v1/groups`, `/api/v1/groups/{id}`                     | Own groups; identity (members/invites for members/owners only); create                              |
| POST / DELETE  | `/api/v1/groups/{id}/invites`                               | Owner creates an email-bound expiring invitation / revokes (`?invite=`)                             |
| PATCH / DELETE | `/api/v1/groups/{id}/members?user=`                         | Owner changes a role / removes a member (members may leave)                                         |
| POST           | `/api/v1/invites/{token}/accept`                            | Accept with the invited signed-in account                                                           |
| GET / POST     | `/api/v1/content`, `/api/v1/content/{id-or-slug}`           | Approved content (authors see their own pending); submit for review                                 |
| POST / DELETE  | `/api/v1/content/{uuid}/save`                               | Save/unsave content                                                                                 |
| POST           | `/api/v1/analytics`                                         | Guest outcome events, allowlisted names only                                                        |

Catalog query parameters: `city` (slug, default houston), `q`, `category`, `neighborhood`, `sort=popular|score|date`, `page` (1-based), and for events `period=today|weekend|week`, `organization` UUID. Lists return `{items,total,page,pageSize:12}`. Products are globally defined; their sighting queries are city-scoped.

Submit place fields: `name,nameChinese?,description,cityId,neighborhood,address,latitude,longitude,category,image?`. Event adds `organizerId,venue,startTime,endTime,capacity?`. Times must be ISO instants; event end must be after start and start in the future. Place/event categories are shared enums. Image references are HTTPS or generated local upload paths. Sighting fields: `productId,placeId,observedAt,price?,image?`; date cannot be in the future, store must be an approved grocery location.

Map query parameters: `city`, `layers` (comma-separated slugs, at most 5, or `none`), `date=upcoming|today|weekend|YYYY-MM-DD|YYYY-MM-DD..YYYY-MM-DD`, `types` (subset of `place,event,content`), `q`, `scope=layers|city`, `area=w,s,e,n`, `item=kind:uuid`, `view=map|list`, `page`. Without `layers` a signed-in user's stored preference applies, otherwise the city's Discover layer. Layers the caller may not view are reported as `unavailable` without titles or counts. Layer creation takes `title,titleChinese?,description?,city,audience=private|group,groupId?,schedule=evergreen|day|range,startsOn?,endsOn?`; updates require the current `revision` and return 409 on conflict. Content submission takes `title,body,titleChinese?,image?,sourceUrl?,placeId?|eventId?,locationStatus,neighborhood?,latitude?/longitude?` (exact only),`validFrom?/validUntil?,city`.

Moderation body: `entityType` in `places|events|products|organizations|notes|sightings|recommendations|layers|content`, `entityId`, `action` in `approved|rejected|hidden|deleted`, `reason`. ADMIN or MODERATOR required; `deleted` requires ADMIN. Editable common fields: `name,nameChinese,description,descriptionChinese,image,category,aliases`. Type-specific edits include place address/coordinates/hours/phone/website; event address/coordinates/venue/start/end/capacity; product brand/onlineUrl; organization website/Instagram/Facebook. Capacity cannot be reduced below current attendance; coordinate edits update PostGIS geometry atomically. Each change creates an audit entry. Public clients cannot set status, role, votes, RSVP counts, verification or author IDs.

Contribution endpoints allow 30 calls/user/minute using PostgreSQL counters. Browser writes validate Origin. Requests from native bearer clients can omit Origin. Do not put tokens into query strings. API changes should remain backward compatible inside `/v1`.
