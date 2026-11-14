import { expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { setUsage } from "./support/usage";

// /record limits and leaving (spec 0021 AC-6 and AC-7). The usage numbers are set in the test
// database, so the page itself reads the limit. No fixed waits: each step waits for the state
// the page shows. The 10 minute cap itself is a unit test (`recordingLimitMs`); here the limit
// is made short through the monthly allowance, which is the same code path.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const ALLOWANCE = 3600;

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

/** Signs in with `secondsLeft` of the monthly allowance left, then opens /record. */
async function open(page: Page, baseURL: string, secondsLeft: number) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  cleanups.push(
    await setUsage(user, {
      enforced: true,
      allowanceSeconds: ALLOWANCE,
      usedSeconds: ALLOWANCE - secondsLeft,
    }),
  );
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  await page.goto("/record");
}

async function startRecording(page: Page) {
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
}

test("the timer shows the limit and warns at one minute left (AC-6)", async ({ page, baseURL }) => {
  // 63 seconds left: the warning shows at 60 seconds left, after about 3 seconds.
  await open(page, baseURL!, 63);
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByTestId("record-limit")).toHaveText("Up to 1:03");
  await page.getByRole("button", { name: "Record" }).click();
  const timer = page.getByTestId("record-timer");
  await expect(timer).toContainText("/ 1:03");
  await expect(page.getByText("The recording stops by itself at the limit.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "One minute left" })).toHaveCount(1);
  await expectNoSeriousAxeIssues(page);

  // Stop by hand ends the take and keeps it for review (the automatic stop is the next test).
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
  await expect(page.getByLabel("Your recording")).toBeVisible();
});

test("a short limit warns at once and the recording stops by itself (AC-6)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!, 5);
  await startRecording(page);
  await expect(page.getByText("The recording stops by itself at the limit.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
});

test("used up: says so, Record is off and the way back is a link (AC-6)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!, 0);
  await expect(page.getByText("No recording time left")).toBeVisible();
  await expect(page.getByText(/You've used this month's 60 minutes/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on camera" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Back to your library" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

test("a refused upload (403) keeps the take and reads the numbers again (AC-6)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!, 5);
  let usageReads = 0;
  await page.route("**/api/usage", (r) => {
    usageReads += 1;
    return r.fulfill({
      json: {
        usedSeconds: ALLOWANCE,
        allowanceSeconds: ALLOWANCE,
        remainingSeconds: 0,
        resetsOn: "2099-01-01",
      },
    });
  });
  await page.route("**/api/uploads", (r) =>
    r.fulfill({
      status: 403,
      json: { error: "limit_exceeded", message: "That would use more than you have left." },
    }),
  );
  await startRecording(page);
  await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
  await page.getByRole("button", { name: "Use this take" }).click();
  await expect(page.getByText("This take wasn't uploaded")).toBeVisible();
  await expect(page.getByLabel("Your recording")).toBeVisible();
  await expect(page.getByRole("link", { name: "Save to your device" })).toBeVisible();
  await expect.poll(() => usageReads).toBeGreaterThan(0);
});

test.describe("leaving with a recording (AC-7)", () => {
  async function reviewScreen(page: Page, baseURL: string) {
    await open(page, baseURL, 5);
    await startRecording(page);
    await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
  }

  test("a link asks first; Stay keeps the take, Leave goes on", async ({ page, baseURL }) => {
    await reviewScreen(page, baseURL!);
    const messages: string[] = [];
    let accept = false;
    page.on("dialog", (dialog) => {
      messages.push(dialog.message());
      return accept ? dialog.accept() : dialog.dismiss();
    });

    const brand = page.getByRole("link", { name: "Take Studio" }).first();
    await brand.click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toBe("Your recording hasn't been uploaded. Leave without it?");
    await expect(page).toHaveURL(/\/record$/);
    await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();

    accept = true;
    await brand.click();
    await expect(page).toHaveURL(/\/library/);
    expect(messages).toHaveLength(2);
  });

  test("closing the tab is warned by the browser while a take is unsent", async ({
    page,
    baseURL,
  }) => {
    await reviewScreen(page, baseURL!);
    const prevented = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test("with nothing to lose, leaving is not asked about", async ({ page, baseURL }) => {
    await open(page, baseURL!, 60);
    let asked = 0;
    page.on("dialog", (dialog) => {
      asked += 1;
      return dialog.dismiss();
    });
    await page.getByRole("link", { name: "Take Studio" }).first().click();
    await expect(page).toHaveURL(/\/library/);
    expect(asked).toBe(0);
  });
});
