import { test, expect } from "@playwright/test";
import { createTestAccount, submitSignIn } from "./fixtures";
/*
 * Custom places (docs/plans/layer-scoped-places-design.md): create, edit and
 * delete a private place from the layer editor. Location comes from a mocked
 * browser position, so no geocoder request is made.
 */
test("a layer owner creates, edits and deletes a custom place", async ({
  page,
}) => {
  await page.goto("/layers/new");
  await expect(page).toHaveURL(/sign-in/);
  const email = `custom-places-${Date.now()}@example.test`;
  await createTestAccount("Place Keeper", email);
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/layers\/new/);
  await page
    .getByLabel("Title", { exact: true })
    .fill(`Hidden gems ${Date.now()}`);
  await page.getByRole("button", { name: "Create layer", exact: true }).click();
  await expect(page).toHaveURL(/\/edit/);
  // Create from the always-available New place button.
  await page.getByRole("button", { name: "New place", exact: true }).click();
  await page.getByLabel("Place name").fill("Uncle Chen Scallion Pancakes");
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 29.705, longitude: -95.55 });
  await page.getByRole("button", { name: "Use my current location" }).click();
  await page.getByRole("button", { name: "Save place" }).click();
  await expect(page.getByText("Place added to this layer.")).toBeVisible();
  const row = page.locator(".layer-contents .result-row", {
    hasText: "Uncle Chen Scallion Pancakes",
  });
  await expect(row).toContainText("Private place");
  // Edit: the form opens prefilled with the saved values and location state.
  await page
    .getByRole("button", { name: "Edit place: Uncle Chen Scallion Pancakes" })
    .click();
  await expect(page.getByRole("heading", { name: "Edit place" })).toBeVisible();
  await expect(page.getByLabel("Place name")).toHaveValue(
    "Uncle Chen Scallion Pancakes",
  );
  await expect(
    page.getByText("Pinned to your current location (approximate)."),
  ).toBeVisible();
  await page.getByLabel("Place name").fill("Uncle Chen Pancakes");
  await page.getByLabel("A short note (optional)").fill("Saturday mornings");
  await page.getByRole("button", { name: "Remove map location" }).click();
  await expect(page.getByText("Not on the map yet.")).toBeVisible();
  await page.getByRole("button", { name: "Save place" }).click();
  await expect(page.getByText("Place updated.")).toBeVisible();
  const renamed = page.locator(".layer-contents .result-row", {
    hasText: "Uncle Chen Pancakes",
  });
  await expect(renamed).toHaveCount(1);
  // Delete asks for confirmation inline, then removes it everywhere.
  await page
    .getByRole("button", { name: "Edit place: Uncle Chen Pancakes" })
    .click();
  await expect(page.getByLabel("A short note (optional)")).toHaveValue(
    "Saturday mornings",
  );
  await expect(page.getByText("Not on the map yet.")).toBeVisible();
  await page.getByRole("button", { name: "Delete place" }).click();
  await expect(
    page.getByText("Delete “Uncle Chen Pancakes” from every layer?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete place" }).click();
  await expect(page.getByText("Place deleted.")).toBeVisible();
  await expect(renamed).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search" }).fill("Uncle Chen");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No results for “Uncle Chen”.")).toBeVisible();
});
test("a private place can be suggested to TaiwanHub for review", async ({
  page,
}) => {
  await page.goto("/layers/new");
  const email = `suggest-${Date.now()}@example.test`;
  await createTestAccount("Place Suggester", email);
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/layers\/new/);
  await page
    .getByLabel("Title", { exact: true })
    .fill(`Worth sharing ${Date.now()}`);
  await page.getByRole("button", { name: "Create layer", exact: true }).click();
  await expect(page).toHaveURL(/\/edit/);
  await page.getByRole("button", { name: "New place", exact: true }).click();
  await page.getByLabel("Place name").fill("Grandpa Wu Beef Noodles");
  await page.getByLabel("Address").fill("9889 Bellaire Blvd");
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 29.705, longitude: -95.55 });
  await page.getByRole("button", { name: "Use my current location" }).click();
  await page.getByRole("button", { name: "Save place" }).click();
  await expect(page.getByText("Place added to this layer.")).toBeVisible();
  await page
    .getByRole("button", { name: "Edit place: Grandpa Wu Beef Noodles" })
    .click();
  await page
    .getByRole("button", { name: "Suggest to TaiwanHub", exact: true })
    .click();
  await page.getByLabel("Category").selectOption("Taiwanese");
  await page.getByLabel("Neighborhood").fill("Chinatown");
  await page
    .getByLabel("Why is it worth adding?")
    .fill("Braised beef noodle soup like in Taipei.");
  await page.getByRole("button", { name: "Send suggestion" }).click();
  await expect(
    page.getByText("Suggestion sent. A moderator will review it."),
  ).toBeVisible();
  await expect(
    page.getByText("Suggested to TaiwanHub. Waiting for a moderator."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Suggest to TaiwanHub", exact: true }),
  ).toHaveCount(0);
});
