import { chromium } from "@playwright/test";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { captionFromDescription, instagramPostUrl } from "./instagram-caption";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix);
export function publicBrowserAddress(address: string) {
  return isIP(address) === 4
    ? !blocked.check(address)
    : isIP(address) === 6 && /^2[0-9a-f]{3}:/i.test(address);
}
export function allowedBrowserUrl(value: string) {
  const u = new URL(value);
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    !u.port &&
    ["instagram.com", "cdninstagram.com", "fbcdn.net"].some(
      (h) => u.hostname === h || u.hostname.endsWith(`.${h}`),
    )
  );
}

/** Ephemeral signed-out context; no saved cookies, login, or challenge bypass. */
export async function readInstagramCaption(value: string, headed = false) {
  const sourceUrl = instagramPostUrl(value);
  const browser = await chromium.launch({ headless: !headed });
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
    let bytes = 0;
    context.on("request", async (request) => {
      // Chromium follows HTTP redirects internally, outside route interception.
      if (!request.redirectedFrom()) return;
      try {
        if (!allowedBrowserUrl(request.url()))
          throw new Error("Unexpected redirect.");
        const addresses = await lookup(new URL(request.url()).hostname, {
          all: true,
        });
        if (
          !addresses.length ||
          addresses.some((a) => !publicBrowserAddress(a.address))
        )
          throw new Error("Non-public redirect.");
      } catch {
        await context.close().catch(() => {});
      }
    });
    context.on("requestfinished", async (request) => {
      try {
        const sizes = await request.sizes();
        bytes += sizes.responseBodySize;
        if (sizes.responseBodySize > 8_000_000 || bytes > 40_000_000)
          await context.close();
      } catch {
        /* Context may already be closed. */
      }
    });
    await context.route("**/*", async (route) => {
      try {
        const req = route.request();
        if (
          ++requests > 100 ||
          !allowedBrowserUrl(req.url()) ||
          ["image", "media", "font"].includes(req.resourceType())
        )
          return await route.abort();
        const addresses = await lookup(new URL(req.url()).hostname, {
          all: true,
        });
        if (
          !addresses.length ||
          addresses.some((a) => !publicBrowserAddress(a.address))
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
  }
}
