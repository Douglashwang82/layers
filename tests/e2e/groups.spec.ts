import { test, expect, type Page } from "@playwright/test";
async function createAccount(page: Page, name: string, email: string) {
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Local-test-passphrase-927!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  // Better Auth allows three sign-ups per 10 seconds per IP; this spec creates several.
  const limited = page
    .getByRole("alert", { name: "" })
    .filter({ hasText: "Too many requests" });
  await Promise.race([
    page.waitForURL("/", { timeout: 15000 }).catch(() => {}),
    limited
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {}),
  ]);
  if (await limited.count()) {
    await page.waitForTimeout(11000);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
  }
  await expect(page).toHaveURL("/");
}
test("group creation, email-bound invitation, restricted layer and revocation", async ({
  browser,
}) => {
  const stamp = Date.now();
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await createAccount(owner, "Group Owner", `owner-${stamp}@example.test`);
  await owner.goto("/groups/new");
  await owner.getByLabel("Group name").fill(`Bayou Students ${stamp}`);
  await owner.getByRole("button", { name: "Create group" }).click();
  await expect(owner).toHaveURL(/\/groups\/bayou-students-/);
  await expect(owner.getByText("1 members · Owner")).toBeVisible();
  const groupUrl = owner.url();
  // Invite by email; the link works only for that account.
  const memberEmail = `member-${stamp}@example.test`;
  await owner.getByLabel("Email of the person to invite").fill(memberEmail);
  await owner.getByLabel("Role", { exact: true }).selectOption("editor");
  await owner.getByRole("button", { name: "Invite a member" }).click();
  const link = await owner.locator(".invite-url code").textContent();
  expect(link).toMatch(/\/groups\/join\/[a-f0-9]{64}$/);
  const joinPath = new URL(link!).pathname;
  // A different signed-in account is refused; the invited one joins as editor.
  const wrongContext = await browser.newContext();
  const wrong = await wrongContext.newPage();
  await createAccount(wrong, "Wrong Person", `wrong-${stamp}@example.test`);
  await wrong.goto(joinPath);
  await wrong.getByRole("button", { name: "Accept invitation" }).click();
  await expect(wrong.locator(".error-message")).toContainText(
    "Sign in with the account this invitation was sent to.",
  );
  await wrongContext.close();
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(joinPath);
  await expect(
    member.getByText("Sign in with the invited account"),
  ).toBeVisible();
  await createAccount(member, "Group Member", memberEmail);
  await member.goto(joinPath);
  await member.getByRole("button", { name: "Accept invitation" }).click();
  await expect(member).toHaveURL(groupUrl);
  await expect(member.getByText("2 members · Editor")).toBeVisible();
  // Editors create group layers; the layer is restricted to members.
  await member.getByRole("link", { name: "Create layer" }).click();
  await expect(member).toHaveURL(/\/layers\/new\?group=/);
  await member
    .getByLabel("Title", { exact: true })
    .fill(`Student favorites ${stamp}`);
  await member
    .getByRole("button", { name: "Create layer", exact: true })
    .click();
  await expect(member).toHaveURL(
    /\/layers\/student-favorites-[a-z0-9-]+\/edit/,
  );
  await member.getByRole("button", { name: "Done" }).click();
  await expect(member.getByText("Group members only").first()).toBeVisible();
  const layerUrl = member.url();
  // Editors cannot change the audience; owners see the layer through the group.
  await expect(
    member.getByRole("button", { name: "Publish layer" }),
  ).toHaveCount(0);
  await owner.goto(layerUrl);
  await expect(
    owner.getByRole("heading", { name: `Student favorites ${stamp}` }),
  ).toBeVisible();
  // Outsiders get a neutral message with no title.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(layerUrl);
  await expect(
    guest.getByText("This layer is unavailable or requires access."),
  ).toBeVisible();
  await expect(guest.locator("body")).not.toContainText("Student favorites");
  await guestContext.close();
  // Revocation removes access on the next request.
  await owner.goto(groupUrl);
  await owner
    .locator(".member-row", { hasText: "Group Member" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(
    owner.locator(".member-row", { hasText: "Group Member" }),
  ).toHaveCount(0);
  await member.goto(layerUrl);
  await expect(
    member.getByText("This layer is unavailable or requires access."),
  ).toBeVisible();
  await member.goto(groupUrl);
  await expect(
    member.getByText(
      "Layers, members and invitations are visible to members only.",
    ),
  ).toBeVisible();
  await memberContext.close();
  await ownerContext.close();
});
