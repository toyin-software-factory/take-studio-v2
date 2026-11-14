import { devices, expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";
import { setUsage } from "./support/usage";

const expect = baseExpect.configure({ timeout: 15_000 });

// Every test writes the same global usage settings, so the whole file runs on one worker in order.
test.describe.configure({ mode: "serial" });

// Monthly usage meter, upload area states and the failed take message (spec 0014 AC-9, AC-14).
// Usage is written straight into Postgres for a fresh test user; the limit switch is the global
// `usage_limit_enabled` row, put back after each test.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `1 Dec` style date of the first of next month (UTC), worked out apart from the app's code. */
function resetLabel(): string {
  const now = new Date();
  return `1 ${MONTHS[(now.getUTCMonth() + 1) % 12]}`;
}

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function setUp(page: Page, baseURL: string, state: Parameters<typeof setUsage>[1]) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup, await setUsage(user, state));
  return user;
}

/** No sideways scroll: the page is no wider than the window (AC-14, phone width). */
async function expectNoSidewaysScroll(page: Page) {
  const extra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(extra).toBeLessThanOrEqual(0);
}

/** A touch target is at least 44 px tall (AC-14). Only asserted on the touch (phone) run. */
async function expectTouchTarget(target: Locator, isMobile: boolean | undefined) {
  if (!isMobile) return;
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

function suite() {
  test("enforced, plenty left: the meter, no notice", async ({ page, baseURL }) => {
    await setUp(page, baseURL!, { usedSeconds: 12 * 60, enforced: true });
    await page.goto("/library");
    const meter = page.getByTestId("usage-meter");
    await expect(meter).toContainText(`12 of 60 minutes used this month · resets ${resetLabel()}`);
    await expect(
      meter.getByRole("progressbar", { name: "Minutes used this month" }),
    ).toHaveAttribute("aria-valuetext", "12 of 60 minutes used this month");
    await expect(meter.getByRole("status")).toBeEmpty();
    await expect(
      page.getByTestId("dropzone").locator("button", { hasText: "Choose a video" }),
    ).toBeEnabled();
    await expectNoSeriousAxeIssues(page);
  });

  test("enforced, 80 % used: a polite notice with the minutes left", async ({ page, baseURL }) => {
    await setUp(page, baseURL!, { usedSeconds: 50 * 60, enforced: true });
    await page.goto("/library");
    await expect(page.getByTestId("usage-meter").getByRole("status")).toHaveText(
      "You have 10 minutes left this month.",
    );
    await expect(
      page.getByTestId("dropzone").locator("button", { hasText: "Choose a video" }),
    ).toBeEnabled();
    await expectNoSeriousAxeIssues(page);
  });

  test("enforced, nothing left: upload is off and says why", async ({ page, baseURL }) => {
    await setUp(page, baseURL!, { usedSeconds: 60 * 60, enforced: true });
    await page.goto("/library");
    const reason = `You've used this month's 60 minutes. They come back on ${resetLabel()}.`;
    await expect(page.getByTestId("dropzone")).toContainText(reason);
    const choose = page.getByTestId("dropzone").locator("button", { hasText: "Choose a video" });
    await expect(choose).toHaveAttribute("aria-disabled", "true");
    await expect(choose).toHaveAccessibleDescription(reason);
    await choose.focus();
    await expect(choose).toBeFocused();
    await expect(page.locator("#upload-video-input")).toBeDisabled();
    await expectNoSeriousAxeIssues(page);
  });

  test("limit switched off: no meter, nothing blocked, even past the allowance", async ({
    page,
    baseURL,
  }) => {
    await setUp(page, baseURL!, { usedSeconds: 90 * 60, enforced: false });
    await page.goto("/library");
    await expect(
      page.getByTestId("dropzone").locator("button", { hasText: "Choose a video" }),
    ).toBeEnabled();
    await expect(page.getByTestId("usage-meter")).toHaveCount(0);
    await expect(page.getByTestId("dropzone")).not.toContainText("come back on");
    await expectNoSeriousAxeIssues(page);
  });

  test("a refused upload reads the numbers again and the area turns off", async ({
    page,
    baseURL,
  }) => {
    await setUp(page, baseURL!, { usedSeconds: 10 * 60, enforced: true });
    const message = `This month's allowance is used up. Your minutes come back on ${resetLabel()}.`;
    const numbers = { usedSeconds: 3600, allowanceSeconds: 3600, remainingSeconds: 0 };
    const resetsOn = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
    )
      .toISOString()
      .slice(0, 10);
    await page.route("**/api/uploads", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 403,
            json: { error: "limit_exceeded", message, ...numbers, resetsOn },
          })
        : route.continue(),
    );
    await page.route("**/api/usage", (route) => route.fulfill({ json: { ...numbers, resetsOn } }));
    await page.goto("/library");
    await expect(page.getByTestId("usage-meter")).toContainText("10 of 60 minutes used");
    await page.locator("#upload-video-input").setInputFiles("tests/fixtures/clip.mp4");
    await expect(page.getByRole("alert").filter({ hasText: "allowance" })).toContainText(message);
    await expect(page.getByTestId("usage-meter")).toContainText("60 of 60 minutes used");
    await expect(
      page.getByTestId("dropzone").locator("button", { hasText: "Choose a video" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  test("a take refused at the limit says when the minutes come back", async ({ page, baseURL }) => {
    const user = await setUp(page, baseURL!, { usedSeconds: 60 * 60, enforced: true });
    const [kept, expiring] = await seedTakes(user.id, [
      {
        title: "Kept",
        status: "failed",
        failureCode: "limit_exceeded",
        durationMs: 60_000,
        expiresInDays: 40,
      },
      {
        title: "Going",
        status: "failed",
        failureCode: "limit_exceeded",
        durationMs: 60_000,
        expiresInDays: 1,
        minutesAgo: 5,
      },
    ]);
    await page.goto("/library");
    const reset = resetLabel();
    await expect(page.getByText(/Your upload is kept until \d+ \w+: try again from/)).toContainText(
      `try again from ${reset}`,
    );
    await expect(page.getByText(/Upload it again/).first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectNoSeriousAxeIssues(page);

    await page.goto(`/takes/${kept}`);
    await expect(page.getByRole("alert").filter({ hasText: "allowance" })).toContainText(
      `try again from ${reset}`,
    );
    await expectNoSeriousAxeIssues(page);
    expect(expiring).toBeTruthy();
  });

  test("the meter and the used up area fit the screen and keep 44 px targets", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    await setUp(page, baseURL!, { usedSeconds: 60 * 60, enforced: true });
    await page.goto("/library");
    await expect(page.getByTestId("usage-meter")).toBeVisible();
    await expectNoSidewaysScroll(page);
    const choose = page.getByTestId("dropzone").locator("button", { hasText: "Choose a video" });
    await expectTouchTarget(choose, isMobile);
    await expect(page.getByTestId("usage-meter").getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      /\d+/,
    );
  });

  test("a take that expires before the reset says to upload it again, on the take page", async ({
    page,
    baseURL,
    isMobile,
  }) => {
    const user = await setUp(page, baseURL!, { usedSeconds: 60 * 60, enforced: true });
    const [expiring] = await seedTakes(user.id, [
      {
        title: "Going",
        status: "failed",
        failureCode: "limit_exceeded",
        durationMs: 60_000,
        expiresInDays: 1,
      },
    ]);
    await page.goto(`/takes/${expiring}`);
    const alert = page.getByRole("alert").filter({ hasText: "Your upload is kept until" });
    await expect(alert).toContainText("before your minutes come back");
    await expect(alert).toContainText("Upload it again then");
    await expectNoSidewaysScroll(page);
    await expectTouchTarget(page.getByRole("button", { name: "Try again" }), isMobile);
    await expectNoSeriousAxeIssues(page);
  });
}

test.describe("desktop", suite);
test.describe("phone", () => {
  // The viewport, touch and scale of a Pixel 7 (the device's browser type can't be set in a group).
  const { viewport, deviceScaleFactor, hasTouch, isMobile, userAgent } = devices["Pixel 7"];
  test.use({ viewport, deviceScaleFactor, hasTouch, isMobile, userAgent });
  suite();
});
