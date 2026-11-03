import { test, expect, type Page } from "@playwright/test";
import { createTestAccount, submitSignIn } from "./fixtures";
import { pool } from "../../packages/database/src";
/*
 * Custom sticker markers: a layer owner picks a photo, circles the object,
 * gets a cut-out with a white band, saves it as the place's pin, and the
 * marker is still there after a reload. The segmentation model is blocked
 * here, so the cut follows the drawn outline (the deterministic fallback).
 */

/** The real Mapbox renderer on an empty fixture style: no live tiles or fees. */
async function mockProvider(page: Page) {
  await page.route(/(\/\/|\.)mapbox\.com\//, async (route) => {
    const url = route.request().url();
    if (url.includes("/styles/"))
      await route.fulfill({
        json: {
          version: 8,
          glyphs:
            "https://api.mapbox.com/fonts/v1/fixture/{fontstack}/{range}.pbf",
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#eee" },
            },
          ],
        },
      });
    else if (url.includes("/fonts/"))
      await route.fulfill({
        contentType: "application/x-protobuf",
        body: Buffer.alloc(0),
      });
    else await route.fulfill({ status: 200, body: "{}" });
  });
}

/** A 400×300 "photo": textured green background with a red ball in the middle. */
async function photo(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#4a7a3a";
    ctx.fillRect(0, 0, 400, 300);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = i % 2 ? "#5d8f47" : "#3d6a30";
      ctx.fillRect((i * 37) % 400, (i * 53) % 300, 6, 6);
    }
    ctx.fillStyle = "#d33";
    ctx.beginPath();
    ctx.arc(200, 150, 60, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** Draws a loop around the stage's center with the mouse (a rough lasso). */
async function circleObject(page: Page) {
  const stage = page.getByRole("img", { name: /Draw a loop around/ });
  const box = (await stage.boundingBox())!;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const rx = box.width * 0.22,
    ry = box.height * 0.3;
  await page.mouse.move(cx + rx, cy);
  await page.mouse.down();
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 24)
    await page.mouse.move(cx + rx * Math.cos(a), cy + ry * Math.sin(a), {
      steps: 2,
    });
  await page.mouse.up();
}

test("a layer owner cuts a sticker out of a photo and keeps it as the place's marker", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Keep the run offline and deterministic: no model download.
  await page.route(/cdn\.jsdelivr\.net|storage\.googleapis\.com/, (route) =>
    route.abort(),
  );
  await mockProvider(page);
  const stamp = Date.now();
  const email = `custom-marker-${stamp}@example.test`;
  await createTestAccount("Sticker Maker", email);
  await page.goto("/layers/new?blank=1");
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/layerPanel=new/);
  // The sign-in helper's spoofed client IP header would also go to
  // cross-origin hosts (forcing CORS preflights); it is not needed after.
  await page.setExtraHTTPHeaders({});
  await page.getByLabel("Title", { exact: true }).fill(`Stickers ${stamp}`);
  await page.getByRole("button", { name: "Create layer", exact: true }).click();
  await expect(page).toHaveURL(/layerPanel=contents.*layer=stickers-/);
  const slug = new URL(page.url()).searchParams.get("layer")!;
  await page.getByRole("button", { name: "New place", exact: true }).click();
  await page.getByLabel("Place name").fill("Red Ball Boba");
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 29.705, longitude: -95.55 });
  await page.getByRole("button", { name: "Use my current location" }).click();
  await page.getByRole("button", { name: "Save place" }).click();
  await expect(page.getByText("Place added to this layer.")).toBeVisible();
  const placeRow = await pool.query<{ id: string }>(
    `SELECT cp.id FROM custom_place cp JOIN "user" u ON u.id=cp.owner_user_id
     WHERE u.email=$1 AND cp.name='Red Ball Boba'`,
    [email],
  );
  const mapUrl = `/?city=houston&layers=${slug}`;
  await page.goto(`${mapUrl}&item=custom:${placeRow.rows[0].id}`);
  const preview = page.locator(".item-preview");
  await expect(
    preview.getByRole("heading", { name: "Red Ball Boba", level: 2 }),
  ).toBeVisible();

  // Pick a photo, circle the ball, preview the sticker.
  await page.getByRole("button", { name: "Custom marker" }).click();
  const dialog = page.getByRole("dialog", { name: "Custom marker" });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "ball.png",
    mimeType: "image/png",
    buffer: await photo(page),
  });
  await expect(dialog.getByText("Roughly circle the object")).toBeVisible();
  await circleObject(page);
  await expect(dialog.getByText("Cut along your outline.")).toBeVisible({
    timeout: 30_000,
  });
  const preview128 = await dialog
    .getByRole("img", { name: "Marker preview" })
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let white = 0,
        red = 0,
        clear = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 10) clear++;
        else if (d[i + 3] > 240 && d[i] > 245 && d[i + 1] > 245) white++;
        else if (d[i + 3] > 240 && d[i] > 180 && d[i + 1] < 90) red++;
      }
      return { w: c.width, h: c.height, white, red, clear };
    });
  // A 128px sticker: transparent corners, the object, and a white band.
  expect(preview128.w).toBe(128);
  expect(preview128.h).toBe(128);
  expect(preview128.clear).toBeGreaterThan(1000);
  expect(preview128.red).toBeGreaterThan(1000);
  expect(preview128.white).toBeGreaterThan(200);

  await dialog.getByRole("button", { name: "Save marker" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Marker saved.")).toBeVisible();
  const attached = page.locator(".place-attachments");
  const thumb = attached.getByRole("img", { name: "Current marker" });
  await expect(thumb).toBeVisible();
  const markerUrl = await thumb.getAttribute("src");
  expect(markerUrl).toMatch(/\.png$/);
  const stored = await pool.query<{ url: string; mime_type: string }>(
    `SELECT im.url, im.mime_type FROM layer_item i JOIN image im ON im.id=i.marker_image_id
     JOIN layer l ON l.id=i.layer_id WHERE l.slug=$1`,
    [slug],
  );
  expect(stored.rows).toEqual([{ url: markerUrl, mime_type: "image/png" }]);

  // After a reload the marker is still the place's pin: the map registers
  // the sticker image (only when a map renders; CI may have no token).
  await page.goto(mapUrl);
  const noMap = page.getByText("Map preview needs a Mapbox token.");
  if (!(await noMap.isVisible()))
    await expect(page.locator('[data-custom-pins="1"]')).toBeAttached({
      timeout: 20_000,
    });
  await page.goto(`${mapUrl}&item=custom:${placeRow.rows[0].id}`);
  await expect(
    page
      .locator(".place-attachments")
      .getByRole("img", { name: "Current marker" }),
  ).toHaveAttribute("src", markerUrl!);

  // Removing it brings back the ordinary pin.
  await page.getByRole("button", { name: "Remove marker" }).click();
  await expect(page.getByText("Marker removed.")).toBeVisible();
  await expect(
    page
      .locator(".place-attachments")
      .getByRole("img", { name: "Current marker" }),
  ).toHaveCount(0);
});
