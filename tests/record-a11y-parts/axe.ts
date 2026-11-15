import { test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "../support/axe";
import { setUsage } from "../support/usage";
import {
  SCHEMES,
  SCRIPT,
  cleanups,
  expect,
  readyWithVoice,
  refuseUpload,
  signedIn,
} from "../fixtures/record-a11y";

export function registerAxe(): void {
  const FAILURES = [
    { error: "NotAllowedError", title: "Camera or microphone is blocked" },
    { error: "NotFoundError", title: "No camera or microphone found" },
    { error: "NotReadableError", title: "Your camera or microphone is busy" },
  ] as const;

  async function toRecording(page: Page) {
    await page.getByLabel("Script (optional)").fill(SCRIPT);
    await page.getByRole("button", { name: "Turn on camera" }).click();
    await page.getByRole("button", { name: "Record" }).click();
    await expect(page.getByTestId("record-timer")).toBeVisible();
  }

  async function turnOnFollowing(page: Page) {
    await page.getByRole("switch", { name: "Follow my voice" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Turn on" }).click();
  }

  for (const scheme of SCHEMES) {
    test.describe(`axe on every /record state, ${scheme} theme (AC-9)`, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
      });

      // One test per state: a state that is slow can't use up the time of the others.
      test("setup", async ({ page, baseURL }) => {
        await signedIn(page, baseURL!);
        await page.goto("/record");
        await expect(page.getByRole("heading", { name: "Record a take" })).toBeVisible();
        await expectNoSeriousAxeIssues(page);
      });

      test("ready", async ({ page, baseURL }) => {
        await signedIn(page, baseURL!);
        await page.goto("/record");
        await page.getByLabel("Script (optional)").fill(SCRIPT);
        await page.getByRole("button", { name: "Turn on camera" }).click();
        await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
        await expectNoSeriousAxeIssues(page);
      });

      test("countdown", async ({ page, baseURL }) => {
        await signedIn(page, baseURL!);
        // The countdown is three real seconds and a scan takes about one, so a slow runner can
        // lose it mid scan. The scan only counts if the countdown was still showing after it;
        // otherwise start again (up to three times).
        const countdown = page.getByRole("status").filter({ hasText: "Recording starts" });
        for (let attempt = 1; attempt <= 3; attempt++) {
          await page.goto("/record");
          await page.getByRole("button", { name: "Turn on camera" }).click();
          await page.getByRole("button", { name: "Record", exact: true }).click();
          await expect(countdown).toBeVisible();
          await expectNoSeriousAxeIssues(page);
          if (await countdown.isVisible()) return;
        }
        throw new Error("The countdown ended before every scan finished");
      });

      test("recording and a paused script", async ({ page, baseURL }) => {
        await signedIn(page, baseURL!);
        await page.goto("/record");
        await toRecording(page);
        await expectNoSeriousAxeIssues(page);
        await page.keyboard.press("p");
        await expect(page.getByTestId("script-scroll")).toHaveAttribute("data-paused", "true");
        await expectNoSeriousAxeIssues(page);
      });

      test("review and a refused upload", async ({ page, baseURL }) => {
        await signedIn(page, baseURL!);
        await refuseUpload(page);
        await page.goto("/record");
        await toRecording(page);
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
            navigator.mediaDevices.getUserMedia = () =>
              Promise.reject(new DOMException("no", name));
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

      test("voice following: the toggle and its first time disclosure", async ({
        page,
        baseURL,
      }) => {
        await readyWithVoice(page, baseURL!);
        const toggle = page.getByRole("switch", { name: "Follow my voice" });
        await expect(toggle).not.toBeChecked();
        await expectNoSeriousAxeIssues(page);

        await toggle.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toContainText("Deepgram");
        await expectNoSeriousAxeIssues(page);
        await dialog.getByRole("button", { name: "Not now" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(toggle).not.toBeChecked();

        await turnOnFollowing(page);
        await expect(toggle).toBeChecked();
        await expectNoSeriousAxeIssues(page);
      });

      test("voice following: connecting and following", async ({ page, baseURL }) => {
        await readyWithVoice(page, baseURL!);
        await turnOnFollowing(page);
        await page.getByRole("button", { name: "Record", exact: true }).click();
        await expect(page.getByTestId("record-timer")).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__sockets.length)).toBe(1);
        await page.evaluate(() => window.__say("line 1 of my script is here"));
        await expect(page.getByText("Following your voice.")).toBeVisible();
        await expectNoSeriousAxeIssues(page);
      });

      test("voice following: the fallback note after no match", async ({ page, baseURL }) => {
        await readyWithVoice(page, baseURL!);
        await turnOnFollowing(page);
        await page.getByRole("button", { name: "Record", exact: true }).click();
        await expect(page.getByTestId("record-timer")).toBeVisible();
        // Nothing is said: after the no match time the note says it is on the timer.
        const note = page.getByRole("status").filter({ hasText: /timer/i });
        await expect(note).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId("script-scroll")).toBeVisible();
        await expectNoSeriousAxeIssues(page);
      });

      test("voice following: the fallback note after a dropped connection", async ({
        page,
        baseURL,
      }) => {
        await readyWithVoice(page, baseURL!);
        await turnOnFollowing(page);
        await page.getByRole("button", { name: "Record", exact: true }).click();
        await expect(page.getByTestId("record-timer")).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__sockets.length)).toBe(1);
        await page.evaluate(() => window.__say("line 1 of my script is here"));
        await expect(page.getByText("Following your voice.")).toBeVisible();
        await page.evaluate(() => window.__drop());
        await expect(page.getByText(/disconnected/i)).toBeVisible();
        await expectNoSeriousAxeIssues(page);
      });

      test("reduced motion steps by line", async ({ page, baseURL }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await signedIn(page, baseURL!);
        await page.goto("/record");
        await toRecording(page);
        await expect(page.locator("[data-testid=script-scroll] [data-current=true]")).toHaveCount(
          1,
        );
        await expectNoSeriousAxeIssues(page);
      });
    });
  }
}
