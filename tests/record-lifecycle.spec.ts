import { expect as baseExpect, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";

// The recorder's lifecycle in the browser (spec 0021 AC-1, AC-2, AC-5, AC-7, B2-T147): the camera
// is let go when nothing needs it, a track lost mid recording ends it with a note, a device
// change that fails keeps the old preview, and the size steps stop at their ends. Chromium's
// fake devices; the page's own getUserMedia is wrapped so each test sees every stream it made.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

type Spy = { __streams: MediaStream[]; __refuseExact: boolean };

/** Every stream the page opens is kept, so a test can ask which tracks are still live. */
async function open(page: Page, baseURL: string, script = "") {
  const { cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  await page.addInitScript(() => {
    const spy = window as unknown as Spy;
    spy.__streams = [];
    spy.__refuseExact = false;
    const media = navigator.mediaDevices;
    const real = media.getUserMedia.bind(media);
    // A second camera that exists on the list but can never be opened (a phone's busy rear lens).
    const realList = media.enumerateDevices.bind(media);
    media.enumerateDevices = async () => [
      ...(await realList()),
      {
        deviceId: "cam-busy",
        groupId: "g2",
        kind: "videoinput",
        label: "Rear camera",
      } as MediaDeviceInfo,
    ];
    media.getUserMedia = async (constraints) => {
      const video = constraints?.video;
      const id =
        typeof video === "object" && video !== null && "deviceId" in video
          ? (video.deviceId as { exact?: string }).exact
          : undefined;
      if (spy.__refuseExact && id === "cam-busy") {
        throw Object.assign(new Error("busy"), { name: "NotReadableError" });
      }
      const stream = await real(constraints);
      spy.__streams.push(stream);
      return stream;
    };
  });
  await page.goto("/record");
  if (script) await page.getByLabel("Script (optional)").fill(script);
}

const live = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Spy).__streams.map(
      (s) => s.getTracks().filter((t) => t.readyState === "live").length,
    ),
  );

async function cameraOn(page: Page) {
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
}

async function recordFor(page: Page, ms: number) {
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await page.waitForTimeout(ms);
}

test("the camera is on for the preview and let go at Stop; Record again asks for it again (AC-1)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await cameraOn(page);
  expect((await live(page)).at(-1)).toBeGreaterThan(0);

  await recordFor(page, 1500);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
  expect(await live(page)).toEqual([0]);

  await page.getByRole("button", { name: "Record again" }).click();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
  const after = await live(page);
  expect(after).toHaveLength(2);
  expect(after[0]).toBe(0);
  expect(after[1]).toBeGreaterThan(0);
});

test("a camera taken away mid recording ends it, keeps what was captured and says why (AC-7)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await cameraOn(page);
  await recordFor(page, 1500);
  // A call taking the camera ends its track; the browser fires `ended` on it.
  await page.evaluate(() => {
    const [stream] = (window as unknown as Spy).__streams.slice(-1);
    stream?.getVideoTracks()[0]?.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
  await expect(page.getByText("Recording stopped early")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "taken away" })).toBeVisible();
  await expect(page.getByLabel("Your recording")).toBeVisible();
  expect(await live(page)).toEqual([0]);
});

test("a device change that cannot open keeps the old preview and says so (AC-1)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await cameraOn(page);
  const camera = page.getByLabel("Camera", { exact: true });
  const before = await camera.innerText();

  await page.evaluate(() => ((window as unknown as Spy).__refuseExact = true));
  await camera.click();
  await page.getByRole("option", { name: "Rear camera" }).click();
  await expect(page.getByText("could not be turned on")).toBeVisible();
  // The old devices came back: the preview is live and Record still works.
  await expect(page.getByRole("button", { name: "Record" })).toBeEnabled();
  expect((await live(page)).at(-1)).toBeGreaterThan(0);
  await expect(camera).toHaveText(before);
  // Nothing opened and then forgotten: only the newest stream is live.
  const counts = await live(page);
  expect(counts.slice(0, -1).every((n) => n === 0)).toBe(true);
});

test("text size steps through 28 to 64 and stops at both ends (AC-2)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!, "A short line of my script.\nAnd a second one.");
  await cameraOn(page);
  const size = page.getByTestId("prompter-size");
  await expect(size).toHaveText("28 px");
  await page.keyboard.press("-");
  await expect(size).toHaveText("28 px");
  for (const next of ["36 px", "44 px", "54 px", "64 px", "64 px", "64 px"]) {
    await page.keyboard.press("+");
    await expect(size).toHaveText(next);
  }
});
