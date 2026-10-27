import { test, expect } from "@playwright/test";
import { createAndSignIn } from "./fixtures";

for (const mobile of [false, true]) {
  test(`layer CRUD stays in the map (${mobile ? "mobile" : "desktop"})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await createAndSignIn(
      page,
      "Map Layer Owner",
      `map-layer-${mobile}-${Date.now()}@example.test`,
    );
    await page.goto("/?layers=none&view=list&layerPanel=library&layerTab=mine");
    const workspace = page.locator(".map-workspace");
    const screen = page.locator(".layer-workspace-screen");
    await expect(
      screen.getByRole("heading", { name: "Layers", exact: true }),
    ).toBeVisible();
    await screen
      .getByRole("link", { name: "Create layer", exact: true })
      .click();
    await expect(page).toHaveURL(/layerPanel=new/);
    await expect(workspace).toBeVisible();
    const title = `Map collection ${Date.now()}`;
    await screen.getByLabel("Title", { exact: true }).fill(title);
    // Closing a dirty form can be cancelled without losing its content.
    page.once("dialog", (dialog) => dialog.dismiss());
    await screen
      .getByRole("link", { name: "Open in Map", exact: true })
      .first()
      .click();
    await expect(screen.getByLabel("Title", { exact: true })).toHaveValue(
      title,
    );
    await screen
      .getByRole("button", { name: "Create layer", exact: true })
      .click();
    await expect(page).toHaveURL(/layerPanel=contents/);
    const slug = new URL(page.url()).searchParams.get("layer")!;
    await expect(page).toHaveURL(/layers=none/);
    await screen
      .getByRole("button", { name: "New place", exact: true })
      .click();
    await screen.getByLabel("Place name").fill("My map-only test place");
    await screen
      .getByRole("button", { name: "Save place", exact: true })
      .click();
    await expect(screen.getByText("Place added to this layer.")).toBeVisible();
    await screen.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page).toHaveURL(/layerPanel=detail/);
    await expect(screen.getByRole("heading", { name: title })).toBeVisible();
    await screen.getByRole("link", { name: "Edit layer", exact: true }).click();
    await expect(page).toHaveURL(/layerPanel=settings/);
    await page.goBack();
    await expect(page).toHaveURL(/layerPanel=detail/);
    await page.goForward();
    await expect(page).toHaveURL(/layerPanel=settings/);
    await expect(
      screen.getByRole("button", { name: "New place", exact: true }),
    ).toHaveCount(0);
    await screen.getByLabel("Title", { exact: true }).fill(title + " updated");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.evaluate(() => window.history.back());
    await expect(screen.getByLabel("Title", { exact: true })).toHaveValue(title + " updated");
    await screen
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(screen.getByText("Save changes ✓")).toBeVisible();
    await screen.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      screen.getByRole("heading", { name: title + " updated" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      screen.getByRole("heading", { name: title + " updated" }),
    ).toBeVisible();
    // Old share links enter the same workspace.
    await page.goto(`/layers/${slug}`);
    await expect(page).toHaveURL(/layerPanel=detail/);
    await expect(workspace).toBeVisible();
    await screen.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(
      screen.getByRole("button", { name: "Restore", exact: true }),
    ).toBeVisible();
    await screen.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(
      screen.getByRole("button", { name: "Archive", exact: true }),
    ).toBeVisible();
    await screen
      .getByRole("button", { name: "Delete layer", exact: true })
      .click();
    await screen
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(page).toHaveURL(/layerPanel=library/);
    await expect(
      screen.getByRole("heading", { name: title + " updated" }),
    ).toHaveCount(0);
    await page.goto(`/layers/${slug}`);
    await expect(
      screen.getByText("This layer is unavailable or requires access."),
    ).toBeVisible();
  });
}
