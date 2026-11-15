import { test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "../support/axe";
import { expect, setUp } from "../fixtures/usage";

export function registerRecord(): void {
  // The /record page and the monthly allowance (spec 0021 AC-6). Chromium's fake camera and
  // microphone record; the allowance is real (seeded above), the upload create is stubbed.
  test.describe("record page (spec 0021 AC-6)", () => {
    test.describe.configure({ timeout: 90_000 });
    const start = async (page: Page) => {
      await page.goto("/record");
      await page.getByRole("button", { name: "Turn on camera" }).click();
      await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
    };

    test("with nothing left Record cannot start and says why", async ({ page, baseURL }) => {
      await setUp(page, baseURL!, { enforced: true, usedSeconds: 3600 });
      await page.goto("/record");
      await expect(page.getByText("No recording time left")).toBeVisible();
      await expect(page.getByText(/They come back on/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Turn on camera" })).toBeDisabled();
      await expectNoSeriousAxeIssues(page);
    });

    test("the limit shows on the timer, warns and is announced, then stops by itself", async ({
      page,
      baseURL,
    }) => {
      // 6 seconds left: the limit is 6 s, under a minute, so the warning shows as soon as it starts.
      await setUp(page, baseURL!, { enforced: true, usedSeconds: 3594 });
      await start(page);
      await expect(page.getByTestId("record-limit")).toHaveText("Up to 0:06");
      await page.getByRole("button", { name: "Record" }).click();
      await expect(page.locator("p[role=status].sr-only")).toHaveText("One minute left");
      await expect(page.getByText(/left\. The recording stops by itself/)).toBeVisible();
      await expectNoSeriousAxeIssues(page);
      // Nobody pressed Stop: the take is in review.
      await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(/^0:0[3-6]$/)).toBeVisible();
    });

    test("a 60 second warning appears before a longer limit", async ({ page, baseURL }) => {
      await setUp(page, baseURL!, { enforced: true, usedSeconds: 3600 - 66 });
      await start(page);
      await expect(page.getByTestId("record-limit")).toHaveText("Up to 1:06");
      await page.getByRole("button", { name: "Record" }).click();
      await expect(page.getByTestId("record-timer")).toBeVisible();
      await expect(page.locator("p[role=status].sr-only")).toHaveText("Recording");
      await expect(page.locator("p[role=status].sr-only")).toHaveText("One minute left", {
        timeout: 20_000,
      });
      await page.getByRole("button", { name: "Stop" }).click();
    });

    test("a refused create keeps the take with the dated message and Save to device", async ({
      page,
      baseURL,
    }) => {
      await setUp(page, baseURL!, { enforced: true, usedSeconds: 3594 });
      const created: { durationHintMs?: number; source?: string }[] = [];
      await page.route("**/api/uploads", (route) => {
        created.push(route.request().postDataJSON());
        return route.fulfill({
          status: 403,
          json: {
            error: "limit_exceeded",
            message: "This video is longer than the minutes you have left this month.",
            usedSeconds: 3594,
            allowanceSeconds: 3600,
            remainingSeconds: 6,
            resetsOn: "2099-01-01",
          },
        });
      });
      await start(page);
      await page.getByRole("button", { name: "Record" }).click();
      await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole("button", { name: "Use this take" }).click();
      await expect(page.getByText("This take wasn't uploaded")).toBeVisible();
      await expect(page.getByText(/longer than the minutes you have left/)).toBeVisible();
      await expect(page.getByLabel("Your recording")).toBeVisible();
      await expect(page.getByRole("link", { name: "Save to device" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      expect(created).toHaveLength(1);
      expect(created[0]?.source).toBe("recording");
      expect(created[0]?.durationHintMs).toBeGreaterThan(0);
      await expectNoSeriousAxeIssues(page);
    });
  });
}
