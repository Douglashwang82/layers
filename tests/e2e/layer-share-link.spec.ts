import { test, expect } from "@playwright/test";
import { createAndSignIn, deleteTestAccount } from "./fixtures";

/*
 * View-only layer share links: the owner creates a link (shown once), a
 * signed-out visitor reads the layer at /shared/<token> with no edit controls,
 * and turning the link off makes the same URL generically unavailable.
 * Default suite: the map home is on in both configs, so the layer detail lives
 * in the map workspace panel either way and needs no flag-specific handling.
 */
test("owner shares a layer by view-only link, a signed-out visitor reads it, turning it off revokes it", async ({
  page,
  browser,
}) => {
  const email = `share-link-${Date.now()}@example.test`;
  await createAndSignIn(page, "Share Link Owner", email);
  try {
    await page.goto("/?layers=none&view=list&layerPanel=new");
    const screen = page.locator(".layer-workspace-screen");
    const title = `Shared collection ${Date.now()}`;
    await screen.getByLabel("Title", { exact: true }).fill(title);
    await screen
      .getByRole("button", { name: "Create layer", exact: true })
      .click();
    await expect(page).toHaveURL(/layerPanel=contents/);
    await screen
      .getByRole("button", { name: "New place", exact: true })
      .click();
    const placeName = `Share link place ${Date.now()}`;
    await screen.getByLabel("Place name").fill(placeName);
    await screen
      .getByRole("button", { name: "Save place", exact: true })
      .click();
    await expect(screen.getByText("Place added to this layer.")).toBeVisible();
    await screen.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page).toHaveURL(/layerPanel=detail/);

    // Create the link; it is displayed once.
    await grantClipboard(page);
    await screen
      .getByRole("button", { name: "Create view-only link", exact: true })
      .click();
    const linkBox = screen.getByLabel("View-only link", { exact: true });
    await expect(linkBox).toBeVisible();
    const url = await linkBox.inputValue();
    expect(url).toMatch(/\/shared\/[^/]+$/);
    const path = new URL(url).pathname;

    // A fresh, signed-out context reads the shared view.
    const visitorContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    try {
      const visitor = await visitorContext.newPage();
      await visitor.goto(path);
      await expect(
        visitor.getByRole("heading", { name: title, level: 1 }),
      ).toBeVisible();
      await expect(visitor.getByText("Shared by Share Link Owner")).toBeVisible();
      await expect(visitor.getByRole("heading", { name: placeName })).toBeVisible();
      await expect(
        visitor.getByText("This is a view-only copy shared by link."),
      ).toBeVisible();
      for (const name of [
        "Edit layer",
        "New place",
        "Create view-only link",
        "Turn off link",
      ]) {
        await expect(
          visitor.getByRole("button", { name }).or(
            visitor.getByRole("link", { name }),
          ),
        ).toHaveCount(0);
      }

      // Turn the link off; the same URL is now generically unavailable.
      await screen
        .getByRole("button", { name: "Turn off link", exact: true })
        .click();
      await expect(screen.getByText("View-only link turned off.")).toBeVisible();
      await visitor.reload();
      await expect(
        visitor.getByRole("heading", {
          name: "This link is no longer available",
        }),
      ).toBeVisible();
      await expect(visitor.getByText(title)).toHaveCount(0);
      await expect(visitor.getByText(placeName)).toHaveCount(0);
    } finally {
      await visitorContext.close();
    }
  } finally {
    await deleteTestAccount(email).catch(() => undefined);
  }
});

async function grantClipboard(page: import("@playwright/test").Page) {
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"])
    .catch(() => undefined);
}
