import { test, expect } from "@playwright/test";
import { createAndSignIn } from "./fixtures";
/*
 * Layer item ratings and comments: a group member rates and comments on a
 * place in a group layer; another member sees the rating badge and the comment
 * immediately (non-public layers skip moderation) and can add their own.
 */
test("a layer item rating and comment is visible to another group member", async ({
  browser,
}) => {
  const stamp = Date.now();
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await createAndSignIn(
    owner,
    "Reviewer Ann",
    `rev-owner-${stamp}@example.test`,
  );
  await owner.goto("/groups/new");
  await owner.getByLabel("Group name").fill(`Noodle Club ${stamp}`);
  await owner.getByRole("button", { name: "Create group" }).click();
  await expect(owner).toHaveURL(/\/groups\/noodle-club-/);
  const groupUrl = owner.url();
  // Invite a second member (read-only viewer) by email.
  const memberEmail = `rev-member-${stamp}@example.test`;
  await owner.getByLabel("Email of the person to invite").fill(memberEmail);
  await owner.getByLabel("Role", { exact: true }).selectOption("viewer");
  await owner.getByRole("button", { name: "Invite a member" }).click();
  const link = await owner.locator(".invite-url code").textContent();
  const joinPath = new URL(link!).pathname;
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await createAndSignIn(member, "Reviewer Ben", memberEmail);
  await member.goto(joinPath);
  await member.getByRole("button", { name: "Accept invitation" }).click();
  await expect(member).toHaveURL(groupUrl);
  // The owner creates a group layer with a private place in it.
  await owner.getByRole("link", { name: "Create layer" }).click();
  await expect(owner).toHaveURL(/layerPanel=new.*group=/);
  await owner
    .getByLabel("Title", { exact: true })
    .fill(`Noodle spots ${stamp}`);
  await owner
    .getByRole("button", { name: "Create layer", exact: true })
    .click();
  await expect(owner).toHaveURL(/layerPanel=contents.*layer=noodle-spots-/);
  await owner.getByRole("button", { name: "New place", exact: true }).click();
  await owner.getByLabel("Place name").fill("Auntie Lin Noodles");
  await owner.context().grantPermissions(["geolocation"]);
  await owner.context().setGeolocation({ latitude: 29.705, longitude: -95.55 });
  await owner.getByRole("button", { name: "Use my current location" }).click();
  await owner.getByRole("button", { name: "Save place" }).click();
  await expect(owner.getByText("Place added to this layer.")).toBeVisible();
  const layerUrl = owner.url();
  // Owner rates 4 stars and comments.
  const ownerRow = owner.locator(".layer-contents .result-row", {
    hasText: "Auntie Lin Noodles",
  });
  await ownerRow
    .locator("summary", { hasText: "Ratings and comments" })
    .click();
  await ownerRow.getByLabel("4 of 5 stars").check();
  await ownerRow
    .getByLabel("Comment")
    .fill("Broth is rich and the noodles chewy.");
  await ownerRow.getByRole("button", { name: "Save review" }).click();
  await expect(owner.getByText("Review saved.")).toBeVisible();
  await expect(ownerRow.locator(".rating-line").first()).toContainText("4.0");
  // The other member sees the badge and the comment, with no moderation step.
  // Viewers get the read view of the layer, where rows carry the rating badge.
  await member.goto(
    layerUrl.replace("layerPanel=contents", "layerPanel=detail"),
  );
  const memberRow = member.locator(".layer-contents .result-row", {
    hasText: "Auntie Lin Noodles",
  });
  await expect(
    memberRow.getByRole("img", { name: "4.0 average from 1 ratings" }),
  ).toBeVisible();
  await memberRow
    .locator("summary", { hasText: "Ratings and comments" })
    .click();
  await expect(
    memberRow.locator("p", { hasText: "Broth is rich and the noodles chewy." }),
  ).toBeVisible();
  await expect(memberRow.getByText("Reviewer Ann")).toBeVisible();
  // The member adds their own rating and comment; the average updates.
  await memberRow.getByLabel("2 of 5 stars").check();
  await memberRow.getByLabel("Comment").fill("Too salty for me.");
  await memberRow.getByRole("button", { name: "Save review" }).click();
  await expect(member.getByText("Review saved.")).toBeVisible();
  await expect(
    memberRow.locator("p", { hasText: "Too salty for me." }),
  ).toBeVisible();
  await expect(
    memberRow.getByRole("img", { name: "3.0 average from 2 ratings" }),
  ).toBeVisible();
  // The owner sees the member's comment after reloading.
  await owner.goto(layerUrl);
  const reloaded = owner.locator(".layer-contents .result-row", {
    hasText: "Auntie Lin Noodles",
  });
  await reloaded
    .locator("summary", { hasText: "Ratings and comments" })
    .click();
  await expect(
    reloaded.locator("p", { hasText: "Too salty for me." }),
  ).toBeVisible();
});
