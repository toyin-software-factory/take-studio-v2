import { expect as baseExpect, type Page } from "@playwright/test";
import { signIn } from "../support/session";

// The accessibility and phone pass on /record and its /design entry (spec 0021 task 5: AC-9,
// AC-10). axe on every recorder state in both themes, a keyboard only run through the flow, and
// a Pixel 7 run. Chromium's fake camera and microphone stand in for a device; the upload API is
// stubbed. Usage is written to the database, so the file runs in order, and the Playwright config runs
// it in its own phase after the other suites (no other test changes those settings meanwhile).
export const expect = baseExpect.configure({ timeout: 30_000 });

declare global {
  interface Window {
    __sockets: unknown[];
    __say: (t: string) => void;
    __drop: () => void;
  }
}

export const SCRIPT = Array.from(
  { length: 10 },
  (_, i) => `Line ${i + 1} of my script is here.`,
).join("\n");

export const SCHEMES = ["light", "dark"] as const;

export const cleanups: (() => Promise<void>)[] = [];

export async function signedIn(page: Page, baseURL: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  return user;
}

/** A refused upload, so the review step shows its failure message beside the take. */
export async function refuseUpload(page: Page) {
  await page.route("**/api/uploads", (route) =>
    route.fulfill({ status: 403, json: { message: "That would use more than you have left." } }),
  );
}

/** A fake Deepgram socket (as in record-follow-voice.spec.ts): no audio leaves the browser. */
export const FAKE_SOCKET = `
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
export async function readyWithVoice(page: Page, baseURL: string) {
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
