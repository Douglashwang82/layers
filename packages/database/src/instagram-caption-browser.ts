import { chromium } from "@playwright/test";

import { captionFromDescription, instagramPostUrl } from "./instagram-caption";

import {
  startInstagramProxy,
  allowedBrowserUrl,
} from "./instagram-browser-proxy";
export {
  publicBrowserAddress,
  allowedBrowserUrl,
} from "./instagram-browser-proxy";
/** Ephemeral signed-out context; no saved cookies, login, or challenge bypass. */
export async function readInstagramCaption(value: string, headed = false) {
  const sourceUrl = instagramPostUrl(value);
  const proxy = await startInstagramProxy();
  const browser = await chromium
    .launch({
      timeout: 10000,
      headless: !headed,
      proxy: { server: proxy.server, bypass: "<-loopback>" },
      args: [
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    })
    .catch((error) => {
      proxy.close();
      throw error;
    });
  const timer = setTimeout(() => {
    void browser.close();
  }, 45000);
  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    let requests = 0;
    await context.route("**/*", async (route) => {
      try {
        const req = route.request();
        if (
          ++requests > 100 ||
          !allowedBrowserUrl(req.url()) ||
          ["image", "media", "font"].includes(req.resourceType())
        )
          return await route.abort();
        await route.continue();
      } catch {
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    await page.goto(sourceUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // Author caption only; never feed the entire page or comments to the model.
    const captionLocator = page.locator("article h1, main h1").first();
    await captionLocator
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
    const heading = await captionLocator
      .textContent({ timeout: 1000 })
      .catch(() => null);
    const description = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content", { timeout: 1000 })
      .catch(() => null);
    const caption = heading?.trim() || captionFromDescription(description);
    if (
      !caption ||
      caption.length > 12000 ||
      /\/accounts\/|\/challenge\//.test(page.url())
    )
      throw new Error(
        "Caption unavailable or too long. Instagram may require login or be limiting access. Use --caption-file with caption text you provide.",
      );
    return {
      sourceUrl,
      caption,
      captionSource: heading?.trim() ? "heading" : "og-description",
      potentiallyTruncated: !heading?.trim(),
    };
  } finally {
    clearTimeout(timer);
    await browser.close();
    proxy.close();
  }
}
