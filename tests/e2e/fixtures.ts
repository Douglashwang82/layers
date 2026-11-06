import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { pool } from "../../packages/database/src";
/**
 * Public sign-up is gone (invitation-only membership, see
 * docs/plans/invitation-membership-implementation-plan.md); these specs don't test
 * that path, they just need a working account. Creating one via direct DB
 * setup - a real password hash Better Auth can verify, plus a legacy
 * admission row - matches the plan's "createInvitedMember"-style fixture
 * (section 12) without adding any HTTP backdoor: nothing here is reachable
 * over the network, it is Node-side Playwright test code only.
 */
export const E2E_PASSWORD = "Local-test-passphrase-927!";
export async function createTestAccount(
  name: string,
  email: string,
  role: "USER" | "ADMIN" = "USER",
) {
  const userId = crypto.randomUUID();
  const hash = await hashPassword(E2E_PASSWORD);
  await pool.query(
    'INSERT INTO "user"(id,name,email,email_verified,role) VALUES($1,$2,$3,true,$4)',
    [userId, name, email, role],
  );
  await pool.query(
    "INSERT INTO account(id,account_id,provider_id,user_id,password) VALUES($1,$2,'credential',$1,$3)",
    [userId, userId, hash],
  );
  await pool.query(
    "INSERT INTO membership_admission(user_id, source) VALUES ($1, 'legacy')",
    [userId],
  );
  return userId;
}
export async function deleteTestAccount(email: string) {
  await pool.query(
    'DELETE FROM membership_admission WHERE user_id IN (SELECT id FROM "user" WHERE email=$1)',
    [email],
  );
  await pool.query('DELETE FROM "user" WHERE email=$1', [email]);
}
/**
 * Fills and submits the password sign-in form on whatever /sign-in?next=...
 * page is already loaded, without navigating or asserting a destination.
 * Email code is the default method, so switch to password first.
 */
export async function submitSignIn(page: Page, email: string) {
  // Each fixture represents a separate client. Keep Better Auth's real limits
  // enabled without having every account in the suite consume one loopback IP.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": [10, ...crypto.getRandomValues(new Uint8Array(3))].join(
      ".",
    ),
  });
  await page.getByRole("button", { name: "Use password", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await submitSignIn(page, email);
  await expect(page).toHaveURL("/");
}
/**
 * The map home starts with the list collapsed. Opens it (retrying until the page
 * has hydrated); it is already open for fallback, list view and shared items.
 */
/** The real Mapbox renderer with no live tiles, for flows that click a pin. */
export async function mockMapProvider(page: Page) {
  const style = {
    version: 8,
    glyphs: "https://api.mapbox.com/fonts/v1/fixture/{fontstack}/{range}.pbf",
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#eee" },
      },
    ],
  };
  await page.route(/(\/\/|\.)mapbox\.com\//, async (route) => {
    const url = route.request().url();
    if (url.includes("/styles/")) await route.fulfill({ json: style });
    else if (url.includes("/fonts/"))
      await route.fulfill({
        contentType: "application/x-protobuf",
        body: Buffer.alloc(0),
      });
    else await route.fulfill({ status: 200, body: "{}" });
  });
}
export async function openMapList(page: Page) {
  const panel = page.locator("#map-panel");
  await expect(async () => {
    // A short click timeout keeps retrying while a client navigation is still
    // rendering; without a token the toggle never appears and the panel opens itself.
    if (!(await panel.isVisible()))
      await page.locator(".map-list-toggle").click({ timeout: 1000 });
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();
}
/** Creates the account and signs the page in, replacing the old public-signup flow in one call. */
export async function createAndSignIn(
  page: Page,
  name: string,
  email: string,
  role: "USER" | "ADMIN" = "USER",
) {
  await createTestAccount(name, email, role);
  await signIn(page, email);
}
/**
 * The map has no Discover layer any more (system layers are off except the
 * Daily Pick), so a guest's map starts empty. Specs that need places on the
 * map load this public, approved member layer holding the seeded Houston
 * places instead. Returns the map URL (`/?layers=<slug>`). Idempotent: the
 * layer is created once per run and reused.
 */
let seededLayerSlug: string | null = null;
/** The URL part that opens a seeded place, by name: pins can't be clicked in CI. */
export async function seededItem(name: string) {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM place WHERE name=$1 LIMIT 1",
    [name],
  );
  expect(rows).toHaveLength(1);
  return `&item=place%3A${rows[0].id}`;
}
export async function seededPlacesMap(extra = "") {
  if (!seededLayerSlug) {
    const owner = crypto.randomUUID();
    const slug = `e2e-seeded-places-${owner.slice(0, 8)}`;
    await pool.query(
      'INSERT INTO "user"(id,name,email,role) VALUES($1,$2,$3,$4)',
      [owner, "Seeded Places", `${owner}@example.test`, "USER"],
    );
    const layer = await pool.query<{ id: string }>(
      `INSERT INTO layer(slug,title,city_id,owner_kind,owner_user_id,audience,lifecycle,review_status)
       SELECT $1,'Seeded places',id,'user',$2,'public','active','approved' FROM city WHERE slug='houston'
       RETURNING id`,
      [slug, owner],
    );
    await pool.query(
      `INSERT INTO layer_item(layer_id,place_id,position,added_by)
       SELECT $1,p.id,row_number() OVER (ORDER BY p.name),$2
       FROM place p JOIN city c ON c.id=p.city_id
       WHERE c.slug='houston' AND p.status='approved'`,
      [layer.rows[0].id, owner],
    );
    seededLayerSlug = slug;
  }
  return `/?layers=${seededLayerSlug}${extra}`;
}
