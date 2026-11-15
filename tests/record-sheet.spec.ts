import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";

// The phone settings sheet on /record (spec 0021 AC-9, B2-T147): the button opens it, Escape and
// the scrim close it, focus goes in and comes back, the closed sheet is out of reach, and the
// wide layout has no sheet. Pixel 7 emulation with the fake camera (the sheet is on the live stage).
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function openRecord(page: Page, baseURL: string) {
  const { cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  await page.goto("/record");
  await expect(page.getByRole("heading", { name: "Record a take" })).toBeVisible();
  // The sheet belongs to the live stage, which opens once the camera is on.
  await page.getByRole("button", { name: "Turn on camera" }).tap();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
}

const trigger = (page: Page) => page.getByRole("button", { name: "Camera and script settings" });

test("on a phone the sheet opens from its button, closes on Escape or the scrim, and returns focus (AC-9)", async ({
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
    await openRecord(page, baseURL!);
    const sheet = page.locator("#rst-sheet");
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
    // Closed: inert, so no control inside can be tabbed to or read.
    await expect(sheet).toHaveAttribute("inert", "");
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");

    await trigger(page).tap();
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
    await expect(sheet).not.toHaveAttribute("inert", "");
    // Focus moved into the sheet.
    await expect.poll(() => sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
    await expect(trigger(page)).toBeFocused();
    await expect(sheet).toHaveAttribute("inert", "");

    // The scrim closes it too.
    await trigger(page).tap();
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
    await page.locator(".rst-scrim").dispatchEvent("click");
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
    await expect(trigger(page)).toBeFocused();
  } finally {
    await context.close();
  }
});

test("turning a phone wide closes the sheet and gives the panel back (AC-9)", async ({
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
    await openRecord(page, baseURL!);
    await trigger(page).tap();
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(page.locator("#rst-sheet")).not.toHaveAttribute("inert", "");
    expect(await page.evaluate(() => document.documentElement.style.overflow)).not.toBe("hidden");
    await page.setViewportSize({ width: 412, height: 800 });
    // Back on a phone the sheet starts closed, not reopened.
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  } finally {
    await context.close();
  }
});
