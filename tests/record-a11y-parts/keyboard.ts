import { devices, test, type Locator, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "../support/axe";
import {
  SCHEMES,
  SCRIPT,
  expect,
  readyWithVoice,
  refuseUpload,
  signedIn,
} from "../fixtures/record-a11y";

export function registerKeyboard(): void {
  /**
   * Tabs forward until this control holds the focus; fails if it is never reached. The control
   * is matched as an element (so a field named by a `<label for>` works too), and focus only ever
   * moves by the Tab key.
   */
  async function tabTo(page: Page, target: Locator) {
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const focused = await target
        .evaluate((el) => el === document.activeElement)
        .catch(() => false);
      if (focused) return;
    }
    throw new Error("Tab never reached the control");
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

    await tabTo(page, page.getByLabel("Script (optional)"));
    await expect(page.getByLabel("Script (optional)")).toBeFocused();
    await page.keyboard.type("Keys stay in the field: - + p");
    await expect(page.getByLabel("Script (optional)")).toHaveValue("Keys stay in the field: - + p");
    await tabTo(page, page.getByRole("button", { name: "Turn on camera", exact: true }));
    await expectVisibleFocus(page);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Pause script", exact: true }));
    await expectVisibleFocus(page);
    await tabTo(page, page.getByRole("button", { name: "Record", exact: true }));
    await expectVisibleFocus(page);
    // Shift+Tab goes back: nothing holds the focus.
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Record" })).not.toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("record-timer")).toBeVisible();
    // No pointer: the shortcut must work with whatever the keyboard left focused.
    await page.keyboard.press("p");
    await expect(page.getByRole("button", { name: "Resume script" })).toBeVisible();
    await page.waitForTimeout(1500);
    await tabTo(page, page.getByRole("button", { name: "Stop", exact: true }));
    await expectVisibleFocus(page);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Use this take", exact: true }));
    await expectVisibleFocus(page);
    await tabTo(page, page.getByRole("button", { name: "Record again", exact: true }));
    await expectVisibleFocus(page);
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Record again" })).not.toBeFocused();
  });

  test("the device pickers and level meter work from the keyboard and lock at the countdown (AC-9)", async ({
    page,
    baseURL,
  }) => {
    await signedIn(page, baseURL!);
    await page.goto("/record");
    await page.getByRole("button", { name: "Turn on camera" }).click();
    await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();

    const meter = page.getByRole("img", { name: /Microphone level:/ });
    await expect(meter).toBeVisible();
    // The meter is also words, so a screen reader hears the level without the bars.
    await expect(page.getByRole("status").filter({ hasText: /\S/ }).first()).toBeVisible();

    const camera = page.getByLabel("Camera", { exact: true });
    const mic = page.getByLabel("Microphone", { exact: true });
    await tabTo(page, camera);
    await expectVisibleFocus(page);
    await tabTo(page, mic);
    await expectVisibleFocus(page);

    await page.getByRole("button", { name: "Record", exact: true }).click();
    await expect(camera).toBeDisabled();
    await expect(mic).toBeDisabled();
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
      // Tapping Record may have scrolled; measure Stop from the unscrolled first screen.
      await page.evaluate(() => window.scrollTo(0, 0));
      const stop = await page.getByRole("button", { name: "Stop" }).boundingBox();
      const viewport = page.viewportSize()!;
      expect(stop!.y).toBeGreaterThanOrEqual(0);
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

  test("Follow my voice works from the keyboard: focus ring, Space, the disclosure and Escape (AC-9)", async ({
    page,
    baseURL,
  }) => {
    await readyWithVoice(page, baseURL!);
    const toggle = page.getByRole("switch", { name: "Follow my voice" });
    await tabTo(page, toggle);
    await expectVisibleFocus(page);
    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(toggle).not.toBeChecked();
  });
}
