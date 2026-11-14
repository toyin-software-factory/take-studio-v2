import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// Self serve Delete account (spec 0015 step 7, AC-13): the account menu item, the confirm
// dialog, the signed out landing, and the stale session path back through sign in. The server
// side (guard, nothing left, magic link round trip) is src/server/account/delete-user.test.ts.
// Synthetic accounts only.

const expect = baseExpect.configure({ timeout: 15_000 });

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function signedIn(page: Page, baseURL: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  return user;
}

async function openDialog(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).first().click();
  await page.getByRole("menuitem", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const [label, viewport] of [
  ["desktop", undefined],
  ["phone", devices["Pixel 7"].viewport],
] as const) {
  test.describe(label, () => {
    if (viewport) test.use({ viewport, hasTouch: true });

    test("the dialog is accessible, Keep my account closes it and returns focus", async ({
      page,
      baseURL,
    }) => {
      await signedIn(page, baseURL!);
      await page.goto("/library");
      if (viewport) await page.getByRole("button", { name: /menu/i }).first().click();
      const dialog = await openDialog(page);
      await expect(dialog).toContainText("It cannot be undone");
      await expectNoSeriousAxeIssues(page);
      await dialog.getByRole("button", { name: "Keep my account" }).click();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/library/);
    });

    test("deleting removes the account and lands on the public page signed out", async ({
      page,
      baseURL,
    }) => {
      const user = await signedIn(page, baseURL!);
      await seedTakes(user.id, [
        { title: "Doomed take", status: "failed", failureCode: "unsupported", minutesAgo: 1 },
      ]);
      await page.goto("/library");
      if (viewport) await page.getByRole("button", { name: /menu/i }).first().click();
      const dialog = await openDialog(page);
      await dialog.getByRole("button", { name: "Delete account" }).click();
      await expect(page).toHaveURL(/\/$/);
      // Signed out: the library sends a visitor to sign in, and the account is gone.
      await page.goto("/library");
      await expect(page).toHaveURL(/\/sign-in/);
    });

    test("a stale session is asked to sign in again, and sign in returns to the dialog", async ({
      page,
      baseURL,
    }) => {
      await signedIn(page, baseURL!);
      await page.route(/\/api\/auth\/delete-user$/, (route) =>
        route.fulfill({
          status: 400,
          json: {
            code: "SESSION_EXPIRED",
            message: "Session expired. Re-authenticate to perform this action.",
          },
        }),
      );
      await page.goto("/library");
      if (viewport) await page.getByRole("button", { name: /menu/i }).first().click();
      const dialog = await openDialog(page);
      await dialog.getByRole("button", { name: "Delete account" }).click();
      await expect(page).toHaveURL(/\/sign-in\?reason=delete-account/);
      await expect(
        page.getByText("For safety, sign in again to delete your account."),
      ).toBeVisible();
      await expectNoSeriousAxeIssues(page);
    });

    test("coming back from a fresh sign in reopens the dialog", async ({ page, baseURL }) => {
      await signedIn(page, baseURL!);
      await page.goto("/library?delete-account=1");
      await expect(page.getByRole("dialog", { name: "Delete your account?" })).toBeVisible();
      await expect(page).not.toHaveURL(/delete-account/);
    });
  });
}

test("a signed in visitor on the stale sign in page goes back to the dialog", async ({
  page,
  baseURL,
}) => {
  await signedIn(page, baseURL!);
  await page.goto("/sign-in?reason=delete-account");
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByRole("dialog", { name: "Delete your account?" })).toBeVisible();
});
