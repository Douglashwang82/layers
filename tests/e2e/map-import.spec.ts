import { test, expect } from "@playwright/test";
import { createTestAccount, submitSignIn } from "./fixtures";
test("preview KML, preserve source layers, and reopen the collection", async ({
  page,
}) => {
  const email = `map-import-${Date.now()}@example.com`;
  await createTestAccount("Map Import", email);
  await page.goto("/map-import");
  await submitSignIn(page, email);
  await expect(
    page.getByRole("heading", { name: "Import a shared map" }),
  ).toBeVisible();
  await page
    .getByLabel("Or upload KML/KMZ (up to 5 MB)")
    .setInputFiles("tests/fixtures/shared-map.kml");
  await page.getByRole("button", { name: "Preview markers" }).click();
  await expect(
    page.getByText(/Unsupported or invalid features skipped: 2/),
  ).toBeVisible();
  await expect(page.getByLabel("Destination")).toHaveValue("collection");
  await expect(
    page.getByRole("button", { name: "Check destination and duplicates" }),
  ).toBeDisabled();
  await page
    .getByLabel("I have permission to reuse this map’s content.")
    .check();
  await page
    .getByRole("button", { name: "Check destination and duplicates" })
    .click();
  await expect(
    page.getByText("New places: 2 · Existing places reused: 0"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/map-import-preview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Import selected markers" }).click();
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  await expect(page.getByText(/Layer entries added: 2/)).toBeVisible();
  await page
    .getByRole("link", { name: "Layer collections", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Tokyo weekend" }),
  ).toBeVisible();
  await page.getByLabel("Food", { exact: true }).check();
  await page.getByLabel("Parks", { exact: true }).check();
  await expect(
    page.getByRole("link", { name: "Show selected layers on map" }),
  ).toHaveAttribute("href", /layers=/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tokyo weekend" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("link", { name: "Import a shared map", exact: true })
    .click();
  await page
    .getByLabel("Or upload KML/KMZ (up to 5 MB)")
    .setInputFiles("tests/fixtures/shared-map.kml");
  await page.getByRole("button", { name: "Preview markers" }).click();
  await page
    .getByRole("combobox", { name: "Destination", exact: true })
    .selectOption("existing");
  await page
    .getByRole("combobox", { name: "Existing layer", exact: true })
    .selectOption({ label: "Food" });
  await page
    .getByLabel("I have permission to reuse this map’s content.")
    .check();
  await page
    .getByRole("button", { name: "Check destination and duplicates" })
    .click();
  await expect(
    page.getByText("New places: 0 · Existing places reused: 2"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/map-import-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Import selected markers" }).click();
  await expect(page.getByText(/Layer entries added: 1/)).toBeVisible();
});
