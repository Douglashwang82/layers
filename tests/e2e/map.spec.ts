import { test, expect } from "@playwright/test";
const noodleHouse = "Little Taipei Noodle House";
test("map home: default layer, selection with Back, filters, layer toggles and provider fallback", async ({
  page,
}) => {
  await page.goto("/");
  // Without a provider token the list is the full experience.
  await expect(
    page.getByText("Map preview needs a Mapbox token"),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /Results/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("status").first()).toContainText(
    "results in this area",
  );
  // Row → shared detail surface, URL state, and Back closes it to the prior results.
  await page
    .getByRole("link", { name: noodleHouse, exact: false })
    .first()
    .click();
  await expect(page).toHaveURL(/item=place%3A|item=place:/);
  await expect(
    page.getByRole("heading", { name: noodleHouse, level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Get directions/ }),
  ).toHaveAttribute("href", /google\.com\/maps/);
  await expect(
    page.getByRole("link", { name: "Open full details →" }),
  ).toHaveAttribute("href", "/places/demo-little-taipei-noodle-house");
  await page.goBack();
  await expect(page).not.toHaveURL(/item=/);
  await expect(
    page.getByRole("heading", { name: noodleHouse, level: 2 }),
  ).toHaveCount(0);
  // Type chip: only places remain; the URL carries the committed filter.
  await page.getByRole("button", { name: "Restaurants", exact: true }).click();
  await expect(page).toHaveURL(/types=place/);
  await expect(page.locator(".result-row[data-type='event']")).toHaveCount(0);
  await expect(
    page.locator(".result-row[data-type='place']").first(),
  ).toBeVisible();
  // Search within applied layers.
  await page.getByRole("searchbox").first().fill("noodle");
  await page
    .getByRole("button", { name: "Search", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/q=noodle/);
  await expect(
    page.getByRole("link", { name: noodleHouse, exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Exit search" }).click();
  await expect(page).not.toHaveURL(/q=/);
  // Hiding the only layer yields the explicit empty state, never a secret default.
  await page.getByRole("tab", { name: /Layers/ }).click();
  const discover = page.getByRole("checkbox", { name: /Discover Houston/ });
  await expect(discover).toBeChecked();
  await discover.uncheck();
  await expect(page).toHaveURL(/layers=none/);
  await expect(page.getByRole("tab", { name: /Results/ })).toContainText("0");
  await discover.check();
  await expect(page).toHaveURL(/layers=discover-houston/);
  await page.getByRole("tab", { name: /Results/ }).click();
  await expect(page.locator(".result-row").first()).toBeVisible();
  // Date preset and list view are URL state too.
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page).toHaveURL(/date=today/);
  await page.getByRole("button", { name: "List view" }).first().click();
  await expect(page).toHaveURL(/view=list/);
  await page.getByRole("button", { name: "Map view" }).click();
  await expect(page).not.toHaveURL(/view=/);
});
test("library Apply adds to the current set; duplicates render once with membership count", async ({
  page,
}) => {
  await page.goto("/?layers=discover-houston&types=place");
  // The workspace remembers the session's map state once hydrated.
  await page.waitForFunction(() =>
    sessionStorage.getItem("taiwanhub:map")?.includes("discover-houston"),
  );
  await page.getByRole("link", { name: "Layers", exact: true }).first().click();
  await expect(page).toHaveURL(/\/layers/);
  const food = page.locator(".layer-card", {
    hasText: "Taiwanese food favorites",
  });
  await food.getByRole("button", { name: "Apply to map" }).click();
  await expect(page).toHaveURL(/layers=discover-houston(,|%2C)food-houston/);
  await expect(page).toHaveURL(/types=place/);
  await page.getByRole("tab", { name: /Layers/ }).click();
  await expect(
    page.getByRole("checkbox", { name: /Taiwanese food favorites/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /Discover Houston/ }),
  ).toBeChecked();
  await page.getByRole("tab", { name: /Results/ }).click();
  const row = page.locator(".result-row", { hasText: noodleHouse });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("In 2 layers");
  // Show only this layer is explicit and keeps the other listed for undo.
  await page.getByRole("tab", { name: /Layers/ }).click();
  await page
    .getByRole("button", { name: "Show only this layer" })
    .first()
    .click();
  await expect(page).toHaveURL(/layers=discover-houston(&|$)/);
  await expect(
    page.getByRole("checkbox", { name: /Taiwanese food favorites/ }),
  ).not.toBeChecked();
  // A shared layer link previews contents and reports a missing one neutrally.
  await page.goto("/layers/food-houston");
  await expect(
    page.getByRole("heading", { name: "Taiwanese food favorites" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await page.goto("/layers/private-secret-layer");
  await expect(
    page.getByText("This layer is unavailable or requires access."),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("secret");
});
test("sign-in return keeps the selected item; personal layer creation, add, apply and My saves", async ({
  page,
}) => {
  await page.goto("/?types=place");
  await page
    .getByRole("link", { name: noodleHouse, exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Display name").fill("Layer Builder");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`layer-builder-${Date.now()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Local-test-passphrase-927!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  // Back on the map with the same item open; the action is presented, not executed.
  await expect(page).toHaveURL(/item=place/);
  await expect(
    page.getByRole("heading", { name: noodleHouse, level: 2 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  // My saves is a private projection over saved tables.
  await page.goto("/saved");
  await page.getByRole("link", { name: "Show on map" }).click();
  await expect(page).toHaveURL(/layers=my-saves/);
  await expect(
    page.locator(".result-row", { hasText: noodleHouse }),
  ).toHaveCount(1);
  // Create a layer with only a title, add an item from the map preview, apply it.
  await page.goto("/layers/new");
  const title = `Weekend plan ${Date.now()}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Date range" }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-09-26");
  await page.getByLabel("To", { exact: true }).fill("2026-09-27");
  await page.getByRole("button", { name: "Create layer", exact: true }).click();
  await expect(page).toHaveURL(/\/layers\/weekend-plan-[a-z0-9-]+\/edit/);
  await page.getByRole("searchbox", { name: "Search" }).fill("noodle");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .locator(".editor-results .result-row", { hasText: noodleHouse })
    .getByRole("button", { name: "Add to layer" })
    .click();
  await expect(
    page.locator(".editor-results .result-row", { hasText: noodleHouse }),
  ).toContainText("Added");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/layers\/weekend-plan-[a-z0-9-]+$/);
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("Private — only you can view").first(),
  ).toBeVisible();
  await expect(page.locator(".layer-contents")).toContainText(noodleHouse);
  await page.getByRole("button", { name: "Apply to map" }).first().click();
  await expect(page).toHaveURL(/layers=.*weekend-plan/);
  await page.getByRole("tab", { name: /Layers/ }).click();
  await expect(
    page.getByRole("checkbox", { name: new RegExp(title) }),
  ).toBeChecked();
  await expect(page.getByText("By you")).toBeVisible();
  // Add to layer from the map preview shows existing membership instead of duplicating.
  await page.getByRole("tab", { name: /Results/ }).click();
  await page
    .getByRole("link", { name: noodleHouse, exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Add to layer" }).click();
  await expect(page.locator(".picker-row", { hasText: title })).toContainText(
    "Already in this layer",
  );
  // Returning users get their layers restored without explicit URL state.
  await page.goto("/");
  await page.getByRole("tab", { name: /Layers/ }).click();
  await expect(
    page.getByRole("checkbox", { name: new RegExp(title) }),
  ).toBeChecked();
});
