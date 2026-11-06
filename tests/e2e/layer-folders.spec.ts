import { test, expect, type Page } from "@playwright/test";
import { createAndSignIn, openMapList } from "./fixtures";
/*
 * Nested layer folders: the main flow, a folder successfully added to the map.
 * Layers are made through the API (the layer UI is covered by
 * layer-workspace.spec.ts); the folder itself is driven through the UI.
 */
type MapPayload = {
  data?: {
    collections: { slug: string; status: string; layerSlugs: string[] }[];
    items: { title?: string; name?: string }[];
  };
};
async function createLayerWithPlace(page: Page, title: string, place: string) {
  const created = await page.request.post("/api/v1/layers", {
    data: { title, city: "houston", audience: "private" },
  });
  expect(created.status()).toBe(201);
  const { layer } = (await created.json()).data as {
    layer: { id: string; slug: string };
  };
  const added = await page.request.post(`/api/v1/layers/${layer.id}/places`, {
    data: { name: place, pin: { latitude: 29.705, longitude: -95.55 } },
  });
  expect(added.status()).toBe(201);
  return layer;
}
/** Resolves with the parsed body, read as soon as the response arrives. */
function mapResponse(page: Page, slug: string): Promise<MapPayload> {
  return page
    .waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v1/map" &&
        r.url().includes(`collections=${slug}`) &&
        r.ok(),
    )
    .then((r) => r.json() as Promise<MapPayload>);
}
test("a folder of layers is added to the map, toggled and restored", async ({
  page,
}) => {
  const stamp = Date.now();
  await createAndSignIn(page, "Folder Owner", `folders-${stamp}@example.test`);
  const layerA = await createLayerWithPlace(
    page,
    `Folder layer A ${stamp}`,
    `Folder place A ${stamp}`,
  );
  const layerB = await createLayerWithPlace(
    page,
    `Folder layer B ${stamp}`,
    `Folder place B ${stamp}`,
  );
  // Create the folder from the layer library.
  await page.goto("/?layers=none&view=list&layerPanel=library&layerTab=mine");
  const screen = page.locator(".layer-workspace-screen");
  await screen.getByRole("button", { name: "New folder", exact: true }).click();
  const folderTitle = `Trip folder ${stamp}`;
  await screen.getByLabel("Folder name", { exact: true }).fill(folderTitle);
  await screen
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  await expect(page).toHaveURL(/layerPanel=folder/);
  const slug = new URL(page.url()).searchParams.get("folder")!;
  expect(slug).toBeTruthy();
  // Add both layers through the folder panel.
  for (const layer of [layerA, layerB]) {
    await screen
      .getByRole("combobox", { name: "Layer to add", exact: true })
      .selectOption({ value: layer.id });
    await screen
      .getByRole("button", { name: "Add layer", exact: true })
      .click();
  }
  await expect(
    screen.getByText(`Folder layer A ${stamp}`).first(),
  ).toBeVisible();
  await expect(
    screen.getByText(`Folder layer B ${stamp}`).first(),
  ).toBeVisible();
  // A sub-folder is created in place and listed under its parent.
  await screen.getByRole("textbox", { name: "New sub-folder" }).fill("Day two");
  await screen
    .getByRole("button", { name: "New sub-folder", exact: true })
    .click();
  await expect(screen.getByText("Day two").first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`folder=${slug}`));
  // Show on map.
  const shown = mapResponse(page, slug);
  await screen
    .getByRole("button", { name: "Show on map", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`collections=${slug}`));
  const payload = (await shown).data!;
  const folder = payload.collections.find((c) => c.slug === slug);
  expect(folder?.status).toBe("ok");
  expect([...folder!.layerSlugs].sort()).toEqual(
    [layerA.slug, layerB.slug].sort(),
  );
  const checkbox = page.getByRole("checkbox", {
    name: `Show ${folderTitle} on map`,
  });
  await expect(checkbox).toBeChecked();
  await expect(page.getByText("1 of 5 on map")).toBeVisible();
  // Toggle off, then on again.
  await checkbox.uncheck();
  await expect(page).not.toHaveURL(/collections=/);
  await expect(checkbox).not.toBeChecked();
  // One tree: no section headings, and a filed layer is only in its folder.
  const manage = page.locator(".active-layers");
  await expect(manage.getByRole("heading", { level: 3 })).toHaveCount(0);
  const filed = page.getByRole("checkbox", {
    name: `Show on map: Folder layer A ${stamp}`,
  });
  await expect(filed).toHaveCount(0);
  await page.getByRole("button", { name: `Expand ${folderTitle}` }).click();
  await expect(filed).toHaveCount(1);
  // A filed layer can go on the map alone, and its folder opens to show that.
  await filed.check();
  await expect(filed).toBeChecked();
  await expect(page).toHaveURL(new RegExp(`layers=${layerA.slug}`));
  await page.reload();
  await expect(filed).toBeChecked();
  await filed.uncheck();
  await expect(page).not.toHaveURL(new RegExp(`layers=${layerA.slug}`));
  const again = mapResponse(page, slug);
  await checkbox.check();
  await expect(page).toHaveURL(new RegExp(`collections=${slug}`));
  expect((await again).data!.collections[0].status).toBe("ok");
  // The folder's layers come with it, so they cannot be unticked one by one.
  await expect(filed).toBeChecked();
  await expect(filed).toBeDisabled();
  // The preference restores the folder when the URL has no map state.
  await page.goto("/");
  await openMapList(page);
  await expect(checkbox).toBeChecked();
});
