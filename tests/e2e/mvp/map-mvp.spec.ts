import { test, expect } from "@playwright/test";
import { createAndSignIn, openMapList } from "../fixtures";
/*
 * Map MVP (docs/plans/layer-mvp-google-links-plan.md), run by
 * playwright.mvp.config.ts with FEATURE_MAP_MVP on and the fake Google link
 * resolver and Places provider: no search, no system layers, layers built
 * from Google Maps links, and events attached to their places.
 */
test("a signed-out visitor sees an empty map without search", async ({
  page,
}) => {
  await page.goto("/");
  await openMapList(page);
  await expect(
    page.getByRole("heading", { name: "Put your places on the map" }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(
    page.locator("#map-panel").getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  // A system layer link loads nothing and reports nothing.
  await page.goto("/?layers=discover-houston&q=noodles&scope=city");
  await expect(page).toHaveURL(/\/\?layers=none$/);
  await openMapList(page);
  await expect(
    page.getByRole("heading", { name: "Put your places on the map" }),
  ).toBeVisible();
  await expect(page.getByText("Layer unavailable")).toHaveCount(0);
});
test("a member builds a layer from Google Maps links and attaches an event", async ({
  page,
}) => {
  await createAndSignIn(
    page,
    "Link Collector",
    `map-mvp-${Date.now()}@example.test`,
  );
  // The empty map points at creating a layer from Google Maps.
  await openMapList(page);
  await expect(
    page.getByRole("heading", { name: "Your layers" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Create a layer from Google Maps" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Create a layer from Google Maps" }),
  ).toBeVisible();
  const title = `Weekend eats ${Date.now()}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Google Maps or Instagram links")
    .fill(
      [
        "https://www.google.com/maps/place/Tiger+Den/@29.7052,-95.5523,17z",
        "Kim Son https://maps.google.com/?q=Kim+Son+Restaurant",
        "https://www.google.com/maps/placelists/list/abc",
        "https://maps.google.com/?q=Kim+Son+Restaurant",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Check links" }).click();
  await expect(page.getByText("2 places found")).toBeVisible();
  await expect(
    page.getByText(/Google Maps lists aren't supported/),
  ).toBeVisible();
  await expect(page.getByText("Same place as an earlier link.")).toBeVisible();
  await expect(page.getByText("From the link: Tiger Den")).toBeVisible();
  await page
    .getByRole("button", { name: "Create layer with 2 places" })
    .click();
  await expect(page).toHaveURL(/layerPanel=detail.*layer=weekend-eats-/);
  const slug = new URL(page.url()).searchParams.get("layer")!;
  await page.getByRole("button", { name: "Apply to map", exact: true }).click();
  await expect(page).toHaveURL(/layers=weekend-eats-/);
  await page
    .locator(".layer-workspace-screen")
    .getByRole("link", { name: "Open in Map", exact: true })
    .first()
    .click();
  // The map shows the layer's places, and there is still no search.
  await openMapList(page);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  const places = page.locator(".mvp-places .external-references li");
  await expect(places).toHaveCount(2);
  await expect(places.first()).toContainText("Tiger Den");
  const backToResults = page.getByRole("button", { name: "Back to results" });
  if (await backToResults.isVisible()) await backToResults.click();
  await expect(page.locator(".fake-provider")).toHaveCount(0);
  await expect(
    places.first().getByRole("link", { name: "Open in Google Maps" }),
  ).toHaveAttribute("href", /query_place_id=/);
  await places.first().getByRole("button", { name: "Open place page" }).click();
  await expect(page.locator(".business-panel .fake-provider")).toHaveCount(0);
  await page.getByRole("button", { name: "Load Google details" }).click();
  await expect(page.locator(".business-panel .fake-provider")).toHaveCount(1);
  await page.getByRole("button", { name: "Close business details" }).click();
  // The header button shows the Layers panel with or without a map.
  await page.getByRole("button", { name: /^Layers \d/ }).click();
  await expect(
    page.getByRole("checkbox", { name: new RegExp(title) }),
  ).toBeChecked();
  // Edit: add another place from a link and an event at the first place.
  await page.goto(`/?layers=${slug}&layerPanel=contents&layer=${slug}`);
  const googlePlaces = page.locator(".google-places > li");
  await expect(googlePlaces).toHaveCount(2);
  await expect(page.locator(".google-places .fake-provider")).toHaveCount(0);
  await page
    .getByLabel("Google Maps or Instagram links")
    .fill("https://maps.google.com/?q=Boba+Corner");
  await page.getByRole("button", { name: "Check links" }).click();
  await page.getByRole("button", { name: "Add 1 places" }).click();
  await expect(page.getByText("1 places added.")).toBeVisible();
  await expect(googlePlaces).toHaveCount(3);
  // Instagram uses the real save endpoint; only extraction/search is mocked.
  const instagramUrl = "https://www.instagram.com/p/test123/";
  await page.route("**/api/v1/google-links/resolve", async (route) => {
    if (!route.request().postDataJSON().links.includes(instagramUrl))
      return route.continue();
    await route.fulfill({
      json: {
        data: {
          results: [
            {
              input: instagramUrl,
              sourceUrl: instagramUrl,
              source: "instagram",
              status: "resolved",
              providerPlaceId: "fake-link-instagram-e2e",
              name: "Test Instagram Cafe",
              address: "100 Test Road",
              potentiallyTruncated: true,
            },
          ],
        },
      },
    });
  });
  await page.getByLabel("Google Maps or Instagram links").fill(instagramUrl);
  await page.getByRole("button", { name: "Check links" }).click();
  await expect(page.getByText("100 Test Road", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add 0 places" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I checked the matched place and address. Add this restaurant.",
    })
    .check();
  await page.getByRole("button", { name: "Add 1 places" }).click();
  await expect(googlePlaces).toHaveCount(4);
  const first = googlePlaces.first();
  await first.locator("summary", { hasText: "Events" }).click();
  await first.getByRole("button", { name: "Add event" }).click();
  await first.getByLabel("Event name").fill("Night market");
  await first.getByLabel("Starts").fill("2099-11-07T18:00");
  await first.getByLabel("Ends").fill("2099-11-07T22:00");
  await first.getByRole("button", { name: "Save event" }).click();
  await expect(first.getByText("Event saved.")).toBeVisible();
  await expect(first.getByText("Night market")).toBeVisible();
  await expect(first).toContainText("6:00");
  // Back on the map, the place carries its upcoming event.
  await page.goto(`/?layers=${slug}`);
  await openMapList(page);
  await expect(places).toHaveCount(4);
  await expect(places.first()).toContainText("Night market");
});

test("large layers page through local summaries without loading provider cards", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("Maximum update depth")
    )
      browserErrors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await createAndSignIn(
    page,
    "Budget Tester",
    `budget-${Date.now()}@example.test`,
  );
  const response = await page.request.post("/api/v1/layers/from-google", {
    data: {
      title: `Budget ${Date.now()}`,
      city: "houston",
      providerPlaceIds: ["fake-link-budget"],
    },
  });
  expect(response.ok()).toBeTruthy();
  const { data } = await response.json();
  const slug = data.layer.slug;
  const refs = Array.from({ length: 65 }, (_, index) => ({
    subjectId: crypto.randomUUID(),
    providerPlaceId:
      index === 0 ? "unavailable-place" : `fake-link-budget-${index}`,
    name: index === 0 ? null : `Local place ${index}`,
    localNote: `Local note ${index}`,
    layers: [slug],
    cityReviewStatus: "approved",
    location: index % 2 ? { lat: 29.76, lng: -95.36 } : null,
  })).map((ref) => ({ ...ref, canonicalKey: `subject:${ref.subjectId}` }));
  const cursors: number[] = [];
  await page.route("**/api/v1/map/external-references?**", async (route) => {
    const cursor = Number(
      new URL(route.request().url()).searchParams.get("cursor") ?? 0,
    );
    cursors.push(cursor);
    await route.fulfill({
      json: {
        data: {
          references: refs.slice(cursor, cursor + 60),
          nextCursor: cursor === 0 ? "60" : null,
          totalAuthorizedReferences: refs.length,
        },
      },
    });
  });
  await page.goto(`/?layers=${slug}`);
  await openMapList(page);
  const rows = page.locator(".external-references li.external-row");
  await expect(rows).toHaveCount(65);
  expect(cursors).toContain(60);
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toContainText("Local place 64");
  await expect(page.locator(".fake-provider")).toHaveCount(0);
  await rows.first().getByRole("button", { name: "Open place page" }).click();
  const panel = page.locator(".business-panel");
  await expect(
    panel.getByRole("button", { name: "Load Google details" }),
  ).toBeVisible();
  await expect(panel.locator(".fake-provider")).toHaveCount(0);
  await panel.getByRole("button", { name: "Load Google details" }).click();
  await expect(
    panel.getByText("Business details are unavailable right now."),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("link", { name: "Open in Google Maps" }),
  ).toHaveAttribute("href", /query_place_id=unavailable-place/);
  expect(browserErrors).toEqual([]);
  await page.reload();
  await openMapList(page);
  await expect(rows).toHaveCount(65);
  await expect(page.locator(".fake-provider")).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});
