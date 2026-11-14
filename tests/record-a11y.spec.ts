import { devices, expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { setUsage } from "./support/usage";

// The accessibility and phone pass on /record and its /design entry (spec 0021 task 5: AC-9,
// AC-10). axe on every recorder state in both themes, a keyboard only run through the flow, and
// a Pixel 7 run. Chromium's fake camera and microphone stand in for a device; the upload API is
// stubbed. Usage is written to the database, so the file runs in order, and the Playwright config runs
// it in its own phase after the other suites (no other test changes those settings meanwhile).
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 120_000, mode: "serial" });
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

declare global {
  interface Window {
    __sockets: unknown[];
    __say: (t: string) => void;
    __drop: () => void;
  }
}

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

/** A fake Deepgram socket (as in record-follow-voice.spec.ts): no audio leaves the browser. */
const FAKE_SOCKET = `
  (() => {
    const sockets = [];
    window.__sockets = sockets;
    class FakeSocket {
      constructor() {
        this.readyState = 0; this.onopen = null; this.onmessage = null; this.onclose = null;
        sockets.push(this);
        setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 20);
      }
      send() {}
      close() { this.readyState = 3; this.onclose && this.onclose({}); }
    }
    FakeSocket.CONNECTING = 0; FakeSocket.OPEN = 1; FakeSocket.CLOSING = 2; FakeSocket.CLOSED = 3;
    window.WebSocket = FakeSocket;
    window.__say = (transcript) => {
      const s = sockets[sockets.length - 1];
      s.onmessage && s.onmessage({ data: JSON.stringify({
        type: "Results", is_final: false,
        channel: { alternatives: [{ transcript, words: transcript.split(" ").map((w) => ({ word: w, punctuated_word: w })) }] },
      }) });
    };
    window.__drop = () => sockets[sockets.length - 1].close();
  })();
`;

/** /record with the camera on and the token route and socket mocked, ready to press Record. */
async function readyWithVoice(page: Page, baseURL: string) {
  await signedIn(page, baseURL);
  await page.addInitScript(FAKE_SOCKET);
  await page.route("**/api/realtime/token", (r) =>
    r.fulfill({ json: { token: "test-token", expiresInSeconds: 60 } }),
  );
  await page.goto("/record");
  await page.getByLabel("Script (optional)").fill(SCRIPT);
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
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

    test("voice following: the toggle and its first time disclosure", async ({ page, baseURL }) => {
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
      await expect(page.locator("[data-testid=script-scroll] [data-current=true]")).toHaveCount(1);
      await expectNoSeriousAxeIssues(page);
    });
  });
}

/**
 * Tabs forward until this control holds the focus; fails if it is never reached. The control
 * is matched as an element (so a field named by a `<label for>` works too), and focus only ever
 * moves by the Tab key.
 */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const focused = await target.evaluate((el) => el === document.activeElement).catch(() => false);
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
