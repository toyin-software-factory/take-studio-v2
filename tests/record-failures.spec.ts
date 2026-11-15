import { expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";

// The /record failures that had no browser test yet (spec 0021 AC-5 and AC-7, B2-T93): no camera
// or microphone, an insecure page, a browser without recording (with and without the phone's
// own camera as the way forward) and the wake lock. Chromium's fake devices stand in for a real
// one; real iPhone, Android, Safari and Firefox runs stay on the verify report's pending list.
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

async function setup(page: Page, baseURL: string) {
  const { cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
}

async function openSetup(page: Page) {
  await page.goto("/record");
  await page.getByRole("button", { name: "Turn on camera" }).click();
}

test("no camera or microphone says so and offers a file upload (AC-5)", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL!);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("none", "NotFoundError"));
  });
  await openSetup(page);
  await expect(page.getByText("No camera or microphone found")).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload a file instead" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

test("an insecure page says so and never asks the camera (AC-5)", async ({ page, baseURL }) => {
  await setup(page, baseURL!);
  await page.addInitScript(() => {
    Object.defineProperty(window, "isSecureContext", { value: false });
    (window as unknown as { __asked: number }).__asked = 0;
    navigator.mediaDevices.getUserMedia = () => {
      (window as unknown as { __asked: number }).__asked++;
      return Promise.reject(new DOMException("never", "NotAllowedError"));
    };
  });
  await openSetup(page);
  await expect(page.getByText("This page isn't secure")).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload a file instead" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(0);
});

test("a browser without recording says so; on a desktop there is no phone camera button (AC-5)", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL!);
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "MediaRecorder");
  });
  await openSetup(page);
  await expect(page.getByText("This browser can't record here")).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload a file instead" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use phone camera app" })).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test("a browser without recording offers the phone's own camera, and its file is uploaded (AC-5)", async ({
    page,
    baseURL,
  }) => {
    await setup(page, baseURL!);
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "MediaRecorder");
    });
    const created: unknown[] = [];
    await page.route("**/api/uploads", (route) => {
      created.push(route.request().postDataJSON());
      return route.fulfill({ status: 403, json: { message: "Stopped on purpose for this test." } });
    });
    await openSetup(page);
    await expect(page.getByText("This browser can't record here")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use phone camera app" })).toBeVisible();
    await page.getByTestId("native-camera-input").setInputFiles({
      name: "from-camera.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("not a real video, a refused create never reads it"),
    });
    await expect.poll(() => created.length).toBe(1);
    expect(created[0]).toMatchObject({ container: "mp4", fileName: "from-camera.mp4" });
  });
});

test("the screen is kept awake while recording and let go at Stop (AC-7)", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL!);
  await page.addInitScript(() => {
    const w = window as unknown as { __lock: { asked: string[]; released: number } };
    w.__lock = { asked: [], released: 0 };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async (type: string) => {
          w.__lock.asked.push(type);
          return { release: async () => void w.__lock.released++ };
        },
      },
    });
  });
  await page.goto("/record");
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  const state = () =>
    page.evaluate(
      () => (window as unknown as { __lock: { asked: string[]; released: number } }).__lock,
    );
  await expect.poll(async () => (await state()).asked).toEqual(["screen"]);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
  await expect.poll(async () => (await state()).released).toBe(1);
});
