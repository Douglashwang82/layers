You are the lead product engineer and technical architect for a new startup product called **TaiwanHub**.

Your job is not merely to generate mockups or isolated components. Your job is to create a production-oriented MVP codebase that can actually be run locally, tested, seeded with data, deployed, and iterated on.

Work like a senior founding engineer.

Do not over-engineer.
Do not build features outside the defined MVP.
Do not generate placeholder architecture that is unnecessarily complex.
Prefer simple, maintainable, strongly typed code.
When a product decision is ambiguous, choose a reasonable default, document the assumption, and continue rather than stopping for broad clarification.

---

# 1. PRODUCT VISION

TaiwanHub is a local discovery and community platform for Taiwanese people living in North America.

The long-term vision is:

**“Life in North America, through Taiwanese eyes.”**

TaiwanHub helps users discover:

- Taiwanese restaurants
- restaurants recommended by Taiwanese people
- Taiwanese community events
- Taiwanese products and where to find them
- Taiwanese-friendly local services
- local Taiwanese organizations and communities

The platform should eventually support cities across the United States and Canada.

However, the first launch market is:

**Houston, Texas**

The system architecture must support multiple cities from the beginning, but the MVP should only seed and optimize the experience for Houston.

---

# 2. PRIMARY PRODUCT PROBLEM

Taiwanese community information currently exists across fragmented sources such as:

- Google Maps
- Facebook Groups
- LINE groups
- Instagram
- Taiwanese association websites
- student associations
- Eventbrite
- local restaurants
- H Mart
- 99 Ranch
- Weee!
- word-of-mouth recommendations

Users have no single trusted place to answer questions such as:

- Where do Taiwanese people recommend eating?
- What Taiwanese events are happening this weekend?
- Where can I buy a specific Taiwanese product?
- Which local businesses are popular among Taiwanese people?
- What Taiwanese organizations exist in my city?

TaiwanHub should aggregate and structure this local knowledge.

---

# 3. MVP PRODUCT PRINCIPLE

The MVP should answer two questions exceptionally well:

1. **Where should I eat?**
2. **What is happening this weekend?**

A lightweight product-discovery feature should also exist, but product inventory tracking is explicitly NOT part of MVP.

The app should feel useful immediately after opening it.

The home page should communicate:

**“What are Taiwanese people around Houston eating, doing, and discovering right now?”**

---

# 4. TARGET USERS

Primary users:

- Taiwanese immigrants living in the United States or Canada
- Taiwanese international students
- Taiwanese professionals
- Taiwanese families
- Taiwanese newcomers to a city
- Taiwanese people traveling to another North American city

Secondary users:

- Taiwanese Americans
- people interested in Taiwanese culture
- local businesses serving Taiwanese customers

For the first MVP, optimize for Taiwanese adults aged roughly 20–45 living in Houston.

The initial UI language should be:

- English as default
- Traditional Chinese supported

The product must be localization-ready from the beginning.

Do not hard-code all copy directly into UI components.

---

# 5. MVP SCOPE

Build these features.

## 5.1 Authentication

Support:

- email authentication
- Google login if implementation is straightforward
- guest browsing without login

Authentication should only be required when a user wants to:

- save something
- RSVP
- recommend a place
- submit content
- follow an organization

User profile fields:

- id
- display name
- avatar
- email
- preferred language
- home city
- optional short bio
- createdAt
- updatedAt

Do NOT collect unnecessary personal information.

---

# 5.2 Location / City System

Create a city-aware platform.

Initial city:

Houston, TX, USA

Data model must support future cities such as:

- Dallas
- Austin
- Los Angeles
- San Francisco Bay Area
- Seattle
- New York City
- Toronto
- Vancouver

Users should be able to change city manually.

Optional browser geolocation can suggest the closest supported city.

Never make geolocation mandatory.

---

# 5.3 Home / Discover Screen

The home screen should contain sections such as:

## Around You

Show relevant nearby or popular content.

## Eat

Show:

- Taiwanese restaurants
- Taiwanese bakeries
- bubble tea
- hot pot
- breakfast
- dessert
- Taiwanese-recommended non-Taiwanese restaurants

Each card should show:

- name
- photo
- category
- neighborhood
- distance if available
- Google-style external rating if available in seeded data
- TaiwanHub recommendation percentage
- number of Taiwanese recommendations

Example:

Taipei Cuisine

Taiwanese · Chinatown

92% Taiwanese Recommended

127 recommendations

## This Weekend

Show upcoming local events.

Examples:

- Mid-Autumn Festival
- basketball meetup
- Taiwanese dinner meetup
- networking event
- student association event
- hiking
- board games
- night market
- cultural festival

Cards should show:

- title
- organization
- date
- time
- neighborhood / venue
- number attending
- category

## Taiwanese Finds

Show recently reported Taiwanese products.

Example:

I-Mei Chocolate Puff

Found at H Mart Bellaire

Reported 2 days ago

---

# 5.4 Restaurant / Place Discovery

Create a Places section.

Users should be able to:

- browse places
- search by name
- filter by category
- filter by neighborhood
- sort by popularity
- sort by Taiwanese recommendation score
- switch between list view and map view
- save a place

Categories should include at minimum:

- Taiwanese
- Bubble Tea
- Bakery
- Hot Pot
- Breakfast
- Dessert
- Asian Grocery
- Japanese
- Korean
- Chinese
- Cafe
- Other

A business does NOT need to be Taiwanese-owned to appear.

TaiwanHub is about what Taiwanese users recommend.

---

# 6. TAIWANESE SCORE

One major differentiator is the **Taiwanese Score**.

Do NOT create a complicated 5-star review system for MVP.

Instead users answer:

**“Would you recommend this place to Taiwanese friends?”**

Options:

- Yes
- No

Calculate:

taiwaneseRecommendationScore =
positiveRecommendations / totalRecommendations * 100

Display:

**92% Taiwanese Recommended**

Also show number of responses.

A user can only have one active recommendation vote per place.

Users may change their vote.

Never allow businesses to pay to manipulate this score.

Sponsored content must remain completely separate from recommendation score.

---

# 7. PLACE DETAIL PAGE

Route example:

/places/[slug]

Include:

- hero image
- business name
- category
- Taiwanese recommendation score
- number of recommendations
- address
- neighborhood
- map
- opening hours if available
- price level if available
- website
- phone
- directions link
- save button
- recommend Yes / No
- short community notes
- recent user recommendations

Users should be allowed to leave a short recommendation note.

Example:

“Beef noodle soup tastes much closer to Taiwan than most places in Houston.”

Keep review UX lightweight.

Do not build Yelp.

---

# 8. EVENTS

Create an Events section.

Filters:

- Today
- This Weekend
- This Week
- category
- organization
- neighborhood

Categories:

- Food
- Sports
- Social
- Networking
- Culture
- Festival
- Student
- Family
- Outdoor
- Professional
- Other

Users should be able to:

- browse events
- view event details
- RSVP
- cancel RSVP
- save event
- share event
- follow organizer

Event fields:

- id
- slug
- title
- description
- cover image
- organizer
- city
- venue
- address
- latitude
- longitude
- start time
- end time
- category
- capacity optional
- external URL optional
- RSVP count
- createdAt
- updatedAt

---

# 9. ORGANIZATIONS

Create organization profiles.

Examples:

- Taiwanese Association
- Taiwanese American Professionals
- Taiwanese Student Associations
- Taiwanese cultural groups
- sports groups
- community organizations

Organization profile fields:

- name
- description
- logo
- website
- Instagram
- Facebook
- city
- verification status

Users can follow organizations.

Organization page should show upcoming events.

Do not implement full organization administration dashboard yet.

Seed the architecture so a business/organization claim feature can be added later.

---

# 10. TAIWANESE PRODUCTS

Create a lightweight Product Discovery feature.

This is NOT real-time inventory.

Users should be able to search:

“I-Mei Puff”

and see:

H Mart Bellaire
Reported 2 days ago

99 Ranch
Reported 8 days ago

Online
Weee!

Product model:

- id
- nameEnglish
- nameChinese
- brand
- category
- image
- aliases

Product sightings model:

- id
- productId
- placeId
- userId
- price optional
- image optional
- observedAt
- createdAt

Allow authenticated users to submit:

**“I found this”**

Submission flow:

1. choose/search product
2. choose store
3. optional price
4. optional image
5. confirm date
6. submit

Do NOT claim inventory is currently available.

Use language such as:

“Recently seen here.”

---

# 11. USER CONTRIBUTION SYSTEM

TaiwanHub requires community-generated data.

Authenticated users should eventually be able to:

- recommend a place
- write a short place note
- submit a missing place
- submit an event
- report a Taiwanese product sighting
- report incorrect information

For MVP implement:

- recommendation vote
- recommendation note
- product sighting
- basic event submission

Content created by users should have moderation status:

- pending
- approved
- rejected

Create simple admin capabilities.

---

# 12. ADMIN

Implement a minimal secure admin area.

Admin should be able to:

- view pending places
- approve/reject place submissions
- view pending events
- approve/reject events
- edit places
- edit events
- edit organizations
- edit products
- hide abusive user content

Admin UI does not need to be visually polished.

Functionality is more important.

Use role-based authorization.

Roles:

USER
MODERATOR
ADMIN

---

# 13. SAVED ITEMS

Users can save:

- places
- events
- products

Create a Saved page organized into sections.

---

# 14. SEARCH

Implement unified search.

Search across:

- places
- events
- organizations
- products

Search should support both English and Traditional Chinese names when available.

Example:

“牛肉麵”

and

“beef noodle”

should both be capable of finding relevant seeded businesses if aliases or descriptions match.

MVP can use PostgreSQL search.

Do not introduce Elasticsearch.

---

# 15. MAP

Implement a map for restaurant discovery.

Preferred provider:

Mapbox

Alternative if necessary:

Google Maps

Map should display place pins.

Clicking a pin should show:

- name
- image
- category
- Taiwanese Score
- link to detail

Do not build complex route planning.

---

# 16. DESIGN DIRECTION

The product should feel:

- modern
- warm
- community-oriented
- premium but approachable
- mobile-first
- visually clean

Avoid making everything red/blue simply because the product is Taiwanese.

Use subtle Taiwanese cultural references.

Possible visual system:

Primary:
deep charcoal / near-black text

Accent:
warm coral / terracotta

Secondary accent:
jade / green

Background:
warm off-white

Cards:
white with subtle borders

Use generous whitespace.

Border radius:
medium to large

Typography:
modern sans-serif

Use imagery heavily for food and events.

Taiwanese identity should come from:

- content
- photography
- language
- community signals

rather than flag-heavy visual design.

---

# 17. MOBILE-FIRST UX

Design primarily for phone screens.

Primary bottom navigation:

Home
Explore
Events
Saved
Profile

Explore can contain:

Places
Products
Organizations

Desktop should use responsive navigation.

Target screen widths:

375px mobile
768px tablet
1440px desktop

---

# 18. ACCESSIBILITY

Implement basic WCAG-conscious design.

Requirements:

- semantic HTML
- keyboard navigation
- accessible labels
- visible focus states
- proper contrast
- alt text for meaningful images
- buttons must not rely only on icons

---

# 19. RECOMMENDED TECH STACK

Use the following unless there is a strong technical reason not to.

## Repository

pnpm workspace / monorepo

Use Turborepo if useful, but do not introduce it if it creates unnecessary complexity.

Recommended structure:

apps/
web/

packages/
database/
ui/
shared/
config/

Prepare architecture so apps/mobile can later contain an Expo app.

---

# 20. FRONTEND

Use:

- Next.js
- TypeScript
- App Router
- React
- Tailwind CSS
- shadcn/ui where useful
- TanStack Query if client-side server state management is needed
- React Hook Form
- Zod

Prefer React Server Components where appropriate.

Do not force everything into client components.

---

# 21. BACKEND

For MVP, use Next.js server capabilities rather than creating a separate microservice.

Use:

- Next.js Route Handlers / Server Actions where appropriate
- PostgreSQL
- PostGIS
- Prisma OR Drizzle ORM

Choose ONE ORM.

Prefer the one you believe provides the cleanest Postgres/PostGIS-compatible implementation.

Explain the decision briefly in README.

Keep business logic outside route handlers.

Use service modules.

Example:

src/
features/
places/
events/
products/
organizations/
users/

Each feature can contain:

repository
service
schema
types

where useful.

---

# 22. DATABASE

Use PostgreSQL.

Enable PostGIS.

Core entities should include:

User
City
Place
PlaceCategory
PlaceRecommendation
PlaceNote
Event
EventRSVP
Organization
OrganizationFollow
Product
ProductSighting
SavedPlace
SavedEvent
SavedProduct
Submission
Image
ModerationAction

Use UUID primary keys.

Use createdAt and updatedAt consistently.

Use unique constraints where logically required.

Use indexes for common queries.

Location entities should support latitude and longitude.

Use PostGIS for future radius queries.

---

# 23. AUTHENTICATION

Use a mature authentication library/provider.

Preferred:

Auth.js

If using Auth.js significantly increases complexity, use a similarly mature alternative.

Authentication system must support future mobile clients.

Avoid architecture that permanently couples identity to browser cookies only.

---

# 24. IMAGE STORAGE

Use a clean abstraction for images.

For local development:

local placeholder files are acceptable.

Production architecture should be compatible with:

- Cloudflare R2
- AWS S3
- Supabase Storage

Do not deeply couple business logic to one image provider.

---

# 25. API DESIGN

Even if Next.js powers both frontend and backend, expose clean HTTP APIs for functionality that a future mobile app will need.

Example:

GET /api/v1/cities

GET /api/v1/places

GET /api/v1/places/:id

POST /api/v1/places/:id/recommendation

GET /api/v1/events

GET /api/v1/events/:id

POST /api/v1/events/:id/rsvp

GET /api/v1/products

POST /api/v1/product-sightings

GET /api/v1/organizations/:id

POST /api/v1/organizations/:id/follow

GET /api/v1/search

Use:

- consistent JSON response format
- validation
- meaningful HTTP status codes
- centralized error handling

Version endpoints under:

/api/v1/

---

# 26. SEED DATA

Seed enough realistic data so the application feels populated immediately.

Do NOT use fake businesses presented as real businesses unless clearly marked as demo data.

For development, use clearly labeled demo content.

Seed approximately:

20 places
10 events
5 organizations
10 products
20 product sightings
15 users
50 recommendation votes

Include neighborhoods such as:

- Bellaire
- Chinatown
- Katy
- Sugar Land
- Downtown Houston
- Midtown

Use believable but clearly demo-safe data.

---

# 27. HOMEPAGE DATA

The homepage should be dynamically generated.

Suggested endpoint/service composition:

getHomeFeed(cityId, userId?)

Return:

featuredPlaces
trendingPlaces
upcomingEvents
recentProductSightings
followedOrganizationEvents if authenticated

Do not hard-code homepage content in JSX.

---

# 28. RANKING

MVP ranking does not need machine learning.

Use transparent ranking formulas.

Example place ranking signals:

Taiwanese Score
number of recommendations
recent recommendation activity
distance
saved count

Example event ranking:

date proximity
RSVP count
organization follow relationship
featured flag

Put ranking logic in dedicated functions that can later be replaced.

---

# 29. ANALYTICS

Create a simple analytics abstraction.

Track events such as:

user_signed_up

place_viewed

place_saved

place_recommended

event_viewed

event_rsvp

organization_followed

product_viewed

product_sighting_submitted

search_performed

city_changed

Do not hard-code analytics provider calls throughout components.

Create something like:

trackEvent(name, properties)

Local development can log analytics to console.

---

# 30. MVP KPI SUPPORT

The product should make it possible to measure:

Activation:
percentage of new users completing at least one core action within 7 days.

Core actions:

- Save
- Follow
- RSVP
- Recommend
- Submit

Retention:
D7
D30

Contribution rate:
percentage of activated users creating content.

Partner activity:
organizations updating/publishing content.

Do not build an elaborate analytics dashboard yet.

Just ensure relevant events/data exist.

---

# 31. SEO

Public place and event pages should be indexable.

Implement:

- metadata
- OpenGraph tags
- canonical URL support
- structured page titles
- sitemap-ready architecture

Example:

Taipei Cuisine — Taiwanese Restaurants in Houston | TaiwanHub

---

# 32. PERFORMANCE

Target good mobile performance.

Use:

- optimized images
- lazy loading
- server-side rendering where appropriate
- pagination
- avoid giant client bundles

Do not prematurely optimize minor issues.

---

# 33. SECURITY

Implement sensible baseline security.

Requirements:

- Zod input validation
- authorization checks server-side
- rate-limit contribution endpoints
- sanitize user-generated text
- protect admin routes
- never trust client-provided user IDs
- secrets only through environment variables
- .env.example
- no secrets committed

---

# 34. PRIVACY

Collect minimal personal data.

Do not expose email addresses publicly.

Do not display exact user location.

Do not store continuous location history.

Location should only be used for explicit nearby queries.

---

# 35. TESTING

Set up:

Unit tests
Integration tests
basic end-to-end tests

Use an appropriate modern testing stack such as:

Vitest
React Testing Library
Playwright

Critical tests should cover:

authentication guards

Taiwanese Score calculation

recommendation upsert behavior

RSVP behavior

event capacity

permissions

search

product sighting creation

admin moderation

---

# 36. DEVELOPMENT ENVIRONMENT

Provide Docker Compose for local PostgreSQL/PostGIS.

Developer startup should ideally be:

pnpm install

docker compose up -d

pnpm db:migrate

pnpm db:seed

pnpm dev

Document everything in README.md.

---

# 37. ENVIRONMENT VARIABLES

Create .env.example.

Likely variables:

DATABASE_URL

AUTH_SECRET

GOOGLE_CLIENT_ID

GOOGLE_CLIENT_SECRET

NEXT_PUBLIC_MAPBOX_TOKEN

IMAGE_STORAGE_*

ANALYTICS_*

Do not require optional third-party integrations simply to boot local development.

---

# 38. NON-GOALS FOR V0.1

DO NOT IMPLEMENT:

chat

direct messaging

forum

dating

jobs board

housing listings

buy/sell marketplace

real-time store inventory

restaurant ordering

payment processing

ticket purchasing

loyalty points

AI chatbot

recommendation ML

complex social feed

business ad platform

full business dashboard

These belong to future phases.

---

# 39. FUTURE ARCHITECTURE

Do not implement these now, but avoid architecture that blocks them:

Expo / React Native mobile client

business profile claiming

business analytics

sponsored listings

service provider directory

ticket sales

affiliate commerce

notifications

social graph

personalized recommendations

multiple North American metros

---

# 40. MVP USER FLOWS

Implement and verify these flows.

## Flow A — Discover restaurant

Open app

→ select Houston

→ see recommended restaurants

→ open place

→ see Taiwanese Score

→ sign in

→ save restaurant

→ recommend Yes

---

## Flow B — Weekend activity

Open Events

→ filter This Weekend

→ open event

→ sign in

→ RSVP

→ see RSVP state updated

---

## Flow C — Find Taiwanese product

Search “義美”

→ open product

→ see recent sightings

→ see H Mart / 99 Ranch sightings

→ submit “I found this”

---

## Flow D — Community contribution

Authenticated user

→ submit event

→ event becomes pending

→ admin sees submission

→ admin approves

→ event appears publicly

---

# 41. ROUTES

Suggested public routes:

/

/explore

/places

/places/[slug]

/events

/events/[slug]

/products

/products/[slug]

/organizations/[slug]

/search

/city/[slug]

Authenticated:

/saved

/profile

/profile/contributions

/submit/place

/submit/event

/submit/product-sighting

Admin:

/admin

/admin/places

/admin/events

/admin/products

/admin/organizations

/admin/moderation

---

# 42. COMPONENT SYSTEM

Create reusable components such as:

PlaceCard

EventCard

ProductCard

OrganizationCard

TaiwaneseScore

SaveButton

RecommendationButton

RSVPButton

SearchBar

CitySelector

CategoryChips

MapView

EmptyState

LoadingSkeleton

ImageUploader

LanguageSwitcher

MobileBottomNav

DesktopHeader

---

# 43. DATA QUALITY

Each place and event should support:

source

lastVerifiedAt

verificationStatus

This will matter later when aggregating community information.

Possible verification states:

UNVERIFIED

COMMUNITY_VERIFIED

OWNER_VERIFIED

ADMIN_VERIFIED

Do not publicly overstate verification.

---

# 44. MODERATION

User-generated content must have basic safety controls.

Allow:

report content

admin hide content

admin delete content

Store moderation audit records.

Do not build advanced automated moderation for MVP.

---

# 45. FEATURE FLAGS

Create a lightweight feature flag mechanism.

Example:

FEATURE_PRODUCTS=true

FEATURE_ORGANIZATIONS=true

FEATURE_SUBMISSIONS=true

Do not use a paid feature flag service.

Environment/config-based flags are sufficient.

---

# 46. CODE QUALITY

Requirements:

strict TypeScript

avoid `any`

use meaningful domain types

keep components reasonably small

avoid giant 1000-line files

do not duplicate schemas

validate at system boundaries

separate UI from domain logic

write clear naming

avoid unnecessary abstractions

avoid premature microservices

prefer composition

---

# 47. DOCUMENTATION

Create:

README.md

docs/architecture.md

docs/database.md

docs/product.md

docs/api.md

docs/deployment.md

docs/future-roadmap.md

README must include:

product overview

architecture

tech stack

local setup

environment variables

database setup

seed instructions

test commands

build instructions

deployment notes

---

# 48. IMPLEMENTATION ORDER

Work in this order.

## Milestone 0 — Repository

Create project.

Configure:

TypeScript

linting

formatting

Tailwind

database

Docker

environment variables

tests

basic CI

---

## Milestone 1 — Database + Auth

Create schema.

Create migrations.

Create seeds.

Implement authentication.

Implement city selection.

---

## Milestone 2 — Places

Implement:

places API

places page

place detail

search/filter

Taiwanese Score

recommendation voting

saving

map

---

## Milestone 3 — Events

Implement:

events API

event listing

event page

This Weekend filter

RSVP

save

organizations

---

## Milestone 4 — Products

Implement:

products

product detail

product sightings

submission flow

---

## Milestone 5 — Community Contribution

Implement:

event submission

basic place submission

moderation status

admin moderation

---

## Milestone 6 — Localization + UX Polish

Implement:

Traditional Chinese

responsive layout

loading states

empty states

error handling

accessibility improvements

---

## Milestone 7 — Testing + Deployment

Finish tests.

Run:

lint

typecheck

unit tests

integration tests

E2E smoke tests

production build

Fix failures.

---

# 49. CI

Create GitHub Actions workflow that runs:

pnpm install

lint

typecheck

test

build

Use dependency caching.

Do not include production deployment secrets.

---

# 50. DEPLOYMENT TARGET

Optimize initial deployment for:

Vercel

PostgreSQL provider can be:

Neon

Supabase PostgreSQL

Railway PostgreSQL

or equivalent.

Because PostGIS is required, choose a provider/setup that supports PostGIS.

Document the recommended deployment architecture.

---

# 51. SUCCESS CRITERIA FOR THE CODEBASE

I should be able to clone the repository and follow README instructions.

I should then be able to:

start PostgreSQL/PostGIS

run migrations

seed database

launch app

browse seeded Houston content

create an account

save a place

recommend a place

see Taiwanese Score update

browse weekend events

RSVP to an event

search for a Taiwanese product

submit a product sighting

submit an event

approve it as admin

see it appear publicly

run the test suite successfully

run a production build successfully

---

# 52. UX QUALITY BAR

Do not deliver a backend with ugly generic CRUD pages.

This is a consumer product.

The MVP should already look like something that could be shown to real beta users and shareholders.

Prioritize polish on:

home

place cards

place detail

events

mobile navigation

search

Taiwanese Score

Use realistic loading skeletons and empty states.

---

# 53. PRODUCT COPY

Use concise copy.

Examples:

Home headline:

“Discover Houston through Taiwanese eyes.”

Subtext:

“Restaurants, events, products, and local favorites recommended by the Taiwanese community.”

Restaurant CTA:

“Would you recommend this to Taiwanese friends?”

Buttons:

“Recommend”

“Save”

“RSVP”

“I found this”

“See on map”

“Get directions”

Event section:

“This Weekend”

Product label:

“Recently seen here”

Avoid overly corporate language.

---

# 54. IMPORTANT PRODUCT RULES

Rule 1:

TaiwanHub is not Yelp.

Avoid long review culture.

Prefer lightweight recommendation signals.

Rule 2:

TaiwanHub is not Facebook.

Do not create an infinite social feed.

Rule 3:

TaiwanHub is not an e-commerce store.

Product discovery indicates recent sightings, not guaranteed inventory.

Rule 4:

TaiwanHub should feel useful before network effects exist.

Seed strong initial content.

Rule 5:

Local density is more important than geographic coverage.

Houston should feel full before adding more cities.

---

# 55. INITIAL NORTH STAR

The product's first behavioral goal is:

A Houston Taiwanese user opens TaiwanHub because they want to decide:

**where to eat**

or

**what to do this weekend**

Then they take at least one community action:

Save
Recommend
RSVP
Follow
Submit

---

# 56. FIRST TASK

Begin by inspecting the current repository.

If the repository is empty:

1. initialize the project
2. establish the architecture
3. create docs/product.md containing the product scope from this specification
4. create docs/architecture.md
5. create the database schema
6. configure PostgreSQL/PostGIS development environment
7. implement seed infrastructure
8. create the initial responsive application shell
9. implement the Houston home screen using seeded data
10. continue into Milestone 1

If there is already code:

1. inspect all important files
2. summarize existing architecture
3. identify what can be reused
4. avoid unnecessary rewrites
5. create a migration plan
6. start implementing the MVP

---

# 57. WORKING STYLE

You are authorized to create and modify the project files required to implement this specification.

Before coding, create a concise implementation checklist.

Then start implementation immediately.

Do not spend the entire response explaining what you plan to do.

Do the work.

After each milestone:

- run relevant tests
- run typecheck
- fix errors
- update documentation
- make a logical git-ready checkpoint

Do not claim something works unless you have actually verified it.

If an external credential is unavailable, create the integration boundary and a local fallback so development can continue.

If you discover an important architectural issue, fix it rather than building more code on top of a broken abstraction.

---

# 58. DELIVERABLE FORMAT AFTER EACH MAJOR MILESTONE

Report:

### Completed

What is implemented.

### Important decisions

Only decisions that materially affect architecture or product behavior.

### Verification

Commands executed and whether they passed.

### Remaining

What comes next.

### Blockers

Only actual blockers.

Do not report hypothetical blockers.

---

# 59. FINAL ENGINEERING PRINCIPLE

Optimize for:

**a real beta launch in Houston**

not:

**a demonstration repository**

The result should be simple enough for a small founding team to maintain, but structured well enough to become the foundation of a real North American Taiwanese community platform.

Start now.
