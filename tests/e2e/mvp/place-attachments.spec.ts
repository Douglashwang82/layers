import { test, expect, type Page } from "@playwright/test";
import { createAndSignIn, mockMapProvider, openMapList } from "../fixtures";
/*
 * Events and tips are attached to a place from the map itself; the former
 * /submit pages are gone.
 */
/** With one place on the map it is framed in the middle of the free canvas. */
async function clickOnlyPin(page: Page) {
  const canvas = page.locator(".mapboxgl-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".map-canvas")).toHaveAttribute("data-camera", /./);
  await page.waitForTimeout(900);
  const box = (await canvas.boundingBox())!;
  const top = (await page.locator(".map-header").boundingBox())!;
  await canvas.click({
    position: {
      x: (box.width - 80) / 2,
      y: (top.y + top.height + 12 + box.height - 80) / 2,
    },
  });
}

test("a member attaches an event and a tip to a place in the map view", async ({
  page,
}) => {
  await createAndSignIn(
    page,
    "Map Attacher",
    `attach-${Date.now()}@example.test`,
  );
  const created = await page.request.post("/api/v1/layers/from-google", {
    data: {
      title: `Attach ${Date.now()}`,
      city: "houston",
      providerPlaceIds: ["fake-link-attach"],
    },
  });
  expect(created.ok()).toBeTruthy();
  const slug = (await created.json()).data.layer.slug as string;

  // A Google place opens from its pin, so this flow needs a (mocked) map.
  await mockMapProvider(page);
  // The fake provider gives no coordinates, so give the place the pin a real one has.
  await page.route("**/api/v1/map/external-references?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const ref of body.data.references)
      ref.location = { lat: 29.76, lng: -95.37 };
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/?layers=${slug}`);
  test.skip(
    await page.getByText("Map preview needs a Mapbox token.").isVisible(),
    "Requires NEXT_PUBLIC_MAPBOX_TOKEN (a fake test token is sufficient).",
  );
  await clickOnlyPin(page);

  const attach = page.locator(".place-attachment");
  await expect(attach).toHaveCount(1);
  // Google places already have layer tips in their details, so only events here.
  await expect(attach.getByRole("heading")).toContainText("Events in");

  // Event: an editor adds it right in the details panel.
  await attach.locator("summary", { hasText: "Events" }).click();
  await attach.getByRole("button", { name: "Add event" }).click();
  await attach.getByLabel("Event name").fill("Dumpling night");
  await attach.getByLabel("Starts").fill("2099-11-07T18:00");
  await attach.getByLabel("Ends").fill("2099-11-07T21:00");
  await attach.getByRole("button", { name: "Save event" }).click();
  await expect(attach.getByText("Event saved.")).toBeVisible();
  await expect(attach.getByText("Dumpling night")).toBeVisible();
  // The map refreshes and shows the event as the place's upcoming event,
  // without remounting the panel.
  await expect(
    page.locator(".attached-events").getByText("Dumpling night"),
  ).toBeVisible();
  await expect(page.locator(".place-attachments")).toHaveCount(1);
  const events = await page.request.get(`/api/v1/layers/${slug}/events`);
  expect(
    (await events.json()).data.events.map((e: { title: string }) => e.title),
  ).toContain("Dumpling night");

  // Tip on the Google place: the business panel's layer-scoped review.
  const business = page.locator(".business-panel");
  await business.getByLabel("5 of 5 stars").check();
  await business.getByLabel("Comment").fill("Order the pork and chive.");
  await business.getByRole("button", { name: "Publish on LocalLink" }).click();
  await expect(business.getByText("Review saved.")).toBeVisible();
  await expect(business).toContainText("1 ratings");
});

test("a member leaves a tip on a custom place in the map view", async ({
  page,
}) => {
  await createAndSignIn(
    page,
    "Tip Leaver",
    `attach-tip-${Date.now()}@example.test`,
  );
  const created = await page.request.post("/api/v1/layers/from-google", {
    data: {
      title: `Tips ${Date.now()}`,
      city: "houston",
      providerPlaceIds: ["fake-link-tips"],
    },
  });
  expect(created.ok()).toBeTruthy();
  const layer = (await created.json()).data.layer as {
    id: string;
    slug: string;
  };
  const place = await page.request.post(`/api/v1/layers/${layer.id}/places`, {
    data: {
      name: "Auntie Mei Bakery",
      pin: { latitude: 29.7604, longitude: -95.3698 },
    },
  });
  expect(place.ok()).toBeTruthy();
  const items = await page.request.get(
    `/api/v1/layers/${layer.id}/items?order=1`,
  );
  const key = ((await items.json()).data.items as { key: string }[]).find((i) =>
    i.key.startsWith("custom:"),
  )!.key;

  await page.goto(`/?layers=${layer.slug}&item=${encodeURIComponent(key)}`);
  await openMapList(page);
  const attach = page.locator(".place-attachment");
  await expect(attach).toHaveCount(1);
  await expect(attach.getByRole("heading")).toContainText("Events and tips in");
  await attach.locator("summary", { hasText: "Ratings and comments" }).click();
  await attach.getByLabel("4 of 5 stars").check();
  await attach.getByLabel("Comment").fill("Pineapple buns sell out by noon.");
  await attach.getByRole("button", { name: "Save review" }).click();
  await expect(attach.getByText("Review saved.")).toBeVisible();
  await expect(
    attach.locator("p", { hasText: "Pineapple buns sell out by noon." }),
  ).toBeVisible();
});

test("a signed-out visitor gets no attach controls and /submit is gone", async ({
  page,
}) => {
  await page.goto("/submit/event");
  await expect(
    page.getByRole("heading", { name: "This page is unavailable." }),
  ).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".place-attachments")).toHaveCount(0);
});
