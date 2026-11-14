import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { setUsage } from "./support/usage";

// The accessibility and phone pass on /record and its /design entry (spec 0021 task 5: AC-9,
// AC-10). axe on every recorder state in both themes, a keyboard only run through the flow, and
// a Pixel 7 run. Chromium's fake camera and microphone stand in for a device; the upload API is
// stubbed. Usage is written to the database, so the whole file runs in order on one worker.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 120_000, mode: "serial" });
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const SCRIPT = Array.from({ length: 10 }, (_, i) => `Line ${i + 1} of my script is here.`).join(
  "\n",
);
const SCHEMES = ["light", "dark"] as const;
const FAILURES = [
  { error: "NotAllowedError", title: "Camera or microphone is blocked" },
  { error: "NotFoundError", title: "No camera or microphone found" },
  { error: "NotReadableError", title: "Your camera or microphone is busy" },
] as const;

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function signedIn(page: Page, baseURL: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  return user;
}

/** A refused upload, so the review step shows its failure message beside the take. */
async function refuseUpload(page: Page) {
  await page.route("**/api/uploads", (route) =>
    route.fulfill({ status: 403, json: { message: "That would use more than you have left." } }),
  );
}

async function toRecording(page: Page) {
  await page.getByLabel("Script (optional)").fill(SCRIPT);
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
}

for (const scheme of SCHEMES) {
  test.describe(`axe on every /record state, ${scheme} theme (AC-9)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
    });

    test("setup, ready, countdown, recording, paused script, review and a refused upload", async ({
      page,
      baseURL,
    }) => {
      await signedIn(page, baseURL!);
      await refuseUpload(page);
      await page.goto("/record");
      await expect(page.getByRole("heading", { name: "Record a take" })).toBeVisible();
      await expectNoSeriousAxeIssues(page);

      await page.getByLabel("Script (optional)").fill(SCRIPT);
      await page.getByRole("button", { name: "Turn on camera" }).click();
      await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
      await expectNoSeriousAxeIssues(page);

      await page.getByRole("button", { name: "Record" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Recording starts" })).toBeVisible();
      await expectNoSeriousAxeIssues(page);

      await expect(page.getByTestId("record-timer")).toBeVisible();
      await expectNoSeriousAxeIssues(page);

      await page.keyboard.press("p");
      await expect(page.getByTestId("script-scroll")).toHaveAttribute("data-paused", "true");
      await expectNoSeriousAxeIssues(page);

      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Stop" }).click();
      await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
      await expectNoSeriousAxeIssues(page);

      await page.getByRole("button", { name: "Use this take" }).click();
      await expect(page.getByText("This take wasn't uploaded")).toBeVisible();
      await expectNoSeriousAxeIssues(page);
    });

    for (const { error, title } of FAILURES) {
      test(`${error} failure`, async ({ page, baseURL }) => {
        await signedIn(page, baseURL!);
        await page.addInitScript((name) => {
          navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("no", name));
        }, error);
        await page.goto("/record");
        await page.getByRole("button", { name: "Turn on camera" }).click();
        await expect(page.getByText(title)).toBeVisible();
        await expectNoSeriousAxeIssues(page);
      });
    }

    test("used up", async ({ page, baseURL }) => {
      const user = await signedIn(page, baseURL!);
      cleanups.push(await setUsage(user, { usedSeconds: 3600, enforced: true }));
      await page.goto("/record");
      await expect(page.getByText("No recording time left")).toBeVisible();
      await expectNoSeriousAxeIssues(page);
    });

    test("the one minute left warning", async ({ page, baseURL }) => {
      const user = await signedIn(page, baseURL!);
      // 62 seconds left: the warning shows two seconds into the recording.
      cleanups.push(await setUsage(user, { usedSeconds: 3538, enforced: true }));
      await page.goto("/record");
      await toRecording(page);
      await expect(page.getByText(/left\. The recording stops by itself/)).toBeVisible();
      await expectNoSeriousAxeIssues(page);
    });

    test("reduced motion steps by line", async ({ page, baseURL }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await signedIn(page, baseURL!);
      await page.goto("/record");
      await toRecording(page);
      await expect(page.locator("[data-testid=script-scroll] [data-current=true]")).toHaveCount(1);
      await expectNoSeriousAxeIssues(page);
    });
  });
}

/** Tabs forward until the focused control has this name; fails if it is never reached. */
async function tabTo(page: Page, name: string) {
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? (el.getAttribute("aria-label") ?? el.textContent ?? "").trim() : "";
    });
    if (label.startsWith(name)) return;
  }
  throw new Error(`Tab never reached "${name}"`);
}

async function expectVisibleFocus(page: Page) {
  const ring = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring.style).not.toBe("none");
  expect(ring.width).toBeGreaterThanOrEqual(2);
}

test("the whole flow works from the keyboard, with a visible focus ring and no trap (AC-9)", async ({
  page,
  baseURL,
}) => {
  await signedIn(page, baseURL!);
  await refuseUpload(page);
  await page.goto("/record");
  await expect(page.getByRole("heading", { name: "Record a take" })).toBeVisible();

  await tabTo(page, "Script");
  await expect(page.getByLabel("Script (optional)")).toBeFocused();
  await page.keyboard.type("Keys stay in the field: - + p");
  await expect(page.getByLabel("Script (optional)")).toHaveValue("Keys stay in the field: - + p");
  await tabTo(page, "Turn on camera");
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
  await tabTo(page, "Pause script");
  await expectVisibleFocus(page);
  await tabTo(page, "Record");
  await expectVisibleFocus(page);
  // Shift+Tab goes back: nothing holds the focus.
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Record" })).not.toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("record-timer")).toBeVisible();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: "Resume script" })).toBeVisible();
  await page.waitForTimeout(1500);
  await tabTo(page, "Stop");
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
  await tabTo(page, "Use this take");
  await expectVisibleFocus(page);
  await tabTo(page, "Record again");
  await expectVisibleFocus(page);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Record again" })).not.toBeFocused();
});

test("on a Pixel 7 the prompter is at the top, controls are in reach and nothing scrolls sideways (AC-10)", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: baseURL!,
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  try {
    await signedIn(page, baseURL!);
    await refuseUpload(page);
    const noSideScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const buttonsAre44 = async () => {
      const heights = await page
        .getByRole("main")
        .getByRole("button")
        .evaluateAll((els) =>
          els
            .filter((el) => (el as HTMLElement).offsetParent !== null)
            .map((el) => el.getBoundingClientRect())
            .map((r) => Math.min(r.width, r.height)),
        );
      for (const size of heights) expect(size).toBeGreaterThanOrEqual(44);
    };

    await page.goto("/record");
    await expect(page.getByRole("heading", { name: "Record a take" })).toBeVisible();
    expect(await noSideScroll()).toBe(true);
    await buttonsAre44();

    await page.getByLabel("Script (optional)").fill(SCRIPT);
    await page.getByRole("button", { name: "Turn on camera" }).tap();
    await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
    expect(await noSideScroll()).toBe(true);
    await buttonsAre44();

    await page.getByRole("button", { name: "Record" }).tap();
    await expect(page.getByTestId("record-timer")).toBeVisible();
    expect(await noSideScroll()).toBe(true);

    // The script is over the top half of the preview, and Stop is on the first screen.
    const text = await page.getByTestId("script-scroll").boundingBox();
    const video = await page.getByLabel("Camera preview").boundingBox();
    expect(text!.y).toBeLessThan(video!.y + video!.height / 2);
    expect(text!.width).toBeLessThanOrEqual(video!.width);
    const stop = await page.getByRole("button", { name: "Stop" }).boundingBox();
    const viewport = page.viewportSize()!;
    expect(stop!.y + stop!.height).toBeLessThanOrEqual(viewport.height);
    await expectNoSeriousAxeIssues(page);

    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Stop" }).tap();
    await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
    expect(await noSideScroll()).toBe(true);
    await buttonsAre44();
  } finally {
    await context.close();
  }
});

for (const scheme of SCHEMES) {
  test(`the /design gallery shows the prompter and recorder controls, ${scheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/design");
    const section = page.getByRole("region", { name: "Prompter and recorder controls" });
    await expect(section.getByRole("button", { name: "Pause script" })).toBeVisible();
    await expect(section.getByRole("button", { name: "Record", exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "Stop" })).toBeVisible();
    await expectNoSeriousAxeIssues(page);
  });
}
