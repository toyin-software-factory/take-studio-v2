import { expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";

// Follow my voice on /record (spec 0021 step 2: AC-12 browser side and the voice parts of AC-9).
// The token route and the Deepgram socket are mocked: no audio leaves the browser in this test.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const SCRIPT = "Welcome everyone to my short synthetic demonstration about gardening tools today";

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

/** A fake WebSocket the test can push Deepgram style results through. */
const FAKE_SOCKET = `
  (() => {
    const sockets = [];
    window.__sockets = sockets;
    window.__sent = 0;
    class FakeSocket {
      constructor(url, protocols) {
        this.url = url; this.protocols = protocols; this.readyState = 0;
        this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
        sockets.push(this);
        setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 20);
      }
      send() { window.__sent += 1; }
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
  })();
`;

async function open(page: Page, baseURL: string, token: "ok" | "limit") {
  const { cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  await page.addInitScript(FAKE_SOCKET);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  await page.route("**/api/realtime/token", (r) =>
    token === "ok"
      ? r.fulfill({ json: { token: "test-token", expiresInSeconds: 60 } })
      : r.fulfill({ status: 429, json: { error: "limit_exceeded" } }),
  );
  await page.goto("/record");
  await page.getByLabel("Script (optional)").fill(SCRIPT);
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
}

test("off by default; the first time it says what is sent and to whom (AC-12, AC-9)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!, "ok");
  const toggle = page.getByRole("switch", { name: "Follow my voice" });
  await expect(toggle).not.toBeChecked();
  await expectNoSeriousAxeIssues(page);

  await toggle.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Deepgram");
  await expect(dialog).toContainText("not sent");
  await expectNoSeriousAxeIssues(page);
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await page.getByRole("dialog").getByRole("button", { name: "Turn on" }).click();
  await expect(toggle).toBeChecked();

  // The second time there is no dialog.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toggle).toBeChecked();
});

test("follows the spoken words and ignores an ad lib (AC-12)", async ({ page, baseURL }) => {
  await open(page, baseURL!, "ok");
  const toggle = page.getByRole("switch", { name: "Follow my voice" });
  await toggle.click();
  await page.getByRole("dialog").getByRole("button", { name: "Turn on" }).click();
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.WebSocket.name)).toBe("FakeSocket");
  await expect(page.getByText("Connecting to follow your voice…")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as never as { __sockets: unknown[] }).__sockets.length))
    .toBe(1);

  const say = (t: string) =>
    page.evaluate((x) => (window as never as { __say: (s: string) => void }).__say(x), t);
  await say("welcome everyone to my short");
  await expect(page.getByText("Following your voice.")).toBeVisible();
  await expectNoSeriousAxeIssues(page);
  await say("so anyway that was a funny thing");
  await expect(page.getByText("Following your voice.")).toBeVisible();
  await say("synthetic demonstration about gardening");
  await expect(page.getByText("Following your voice.")).toBeVisible();
});

test("a refused token falls back to timed scrolling with a visible note (AC-12)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!, "limit");
  await page.getByRole("switch", { name: "Follow my voice" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Turn on" }).click();
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /timer|timed|scroll/i })).toBeVisible();
  await expect(page.getByTestId("script-scroll")).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});
