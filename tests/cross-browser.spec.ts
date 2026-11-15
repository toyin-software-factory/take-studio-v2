import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// The key flows in Safari's engine (WebKit) and Firefox's engine as well as Chromium (B2-T102):
// the sign in page, the library, a ready take page and the /record permission states. Only
// engine neutral checks live here: structure, names, no sideways scroll and axe. Playwright's
// WebKit and Firefox have no fake camera flags, so getUserMedia is stubbed in the page. What
// these engines cannot show (real cameras, VoiceOver, iOS Safari itself) is on the human pass:
// docs/reviews/launch-device-pass.md. The `webkit` and `firefox` projects run only this file.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });

const clip = readFileSync("tests/fixtures/clip.mp4");
const R2 = "https://r2.test";

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

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("the sign in page shows Google and the email form, accessible", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { level: 1, name: "Sign in to Take Studio" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a sign in link" })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await expectNoSeriousAxeIssues(page);
});

test("the library lists a take and does not scroll sideways", async ({ page, baseURL }) => {
  const user = await signedIn(page, baseURL!);
  await seedTakes(user.id, [
    { title: "Browser check take", status: "ready", durationMs: 5000, minutesAgo: 1 },
  ]);
  await page.goto("/library");
  await expect(page).toHaveTitle("Your takes · Take Studio");
  await expect(page.getByRole("main").getByText("Browser check take")).toBeVisible();
  await expect(page.getByText("MP4 or MOV, up to 10 minutes, 2 GB, 1080p")).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await expectNoSeriousAxeIssues(page);
});

test("a ready take page shows the title, the player and the downloads", async ({
  page,
  baseURL,
}) => {
  const user = await signedIn(page, baseURL!);
  const [id] = await seedTakes(user.id, [
    {
      title: "Browser check take",
      status: "ready",
      durationMs: 120_000,
      steps: [
        { name: "trim", status: "succeeded" },
        { name: "render", status: "succeeded" },
      ],
      removedRanges: [{ startMs: 1000, endMs: 30_000 }],
    },
  ]);
  await page.route("**/api/takes/*/media?kind=play", (route) =>
    route.fulfill({ json: { url: `${R2}/clip.mp4`, expiresInSeconds: 3600 } }),
  );
  await page.route(`${R2}/clip.mp4`, (route) =>
    route.fulfill({
      body: clip,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.goto(`/takes/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Browser check take" })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Video player" }).getByRole("button", { name: "Play" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  // axe crashes Playwright's Firefox on this page in CI ("Page crashed" inside axe's frame
  // evaluate, with the video element mounted). Chromium and WebKit run it here, and Chromium's
  // takes.library.spec.ts runs it too. The Firefox look is on the device pass instead
  // (docs/reviews/launch-device-pass.md, step 4.5).
  if (test.info().project.name !== "firefox") await expectNoSeriousAxeIssues(page);
});

const FAILURES = [
  { error: "NotAllowedError", title: "Camera or microphone is blocked" },
  { error: "NotFoundError", title: "No camera or microphone found" },
  { error: "NotReadableError", title: "Your camera or microphone is busy" },
] as const;

for (const { error, title } of FAILURES) {
  test(`/record says "${title}" when the browser answers ${error}`, async ({ page, baseURL }) => {
    await signedIn(page, baseURL!);
    await page.addInitScript((name) => {
      // Playwright's WebKit build has no MediaRecorder, so the recorder would stop at "This
      // browser can't record here" before it ever asks for the camera. A bare stand in lets the
      // test reach the camera answer; it is never constructed because the stub always rejects.
      if (typeof MediaRecorder === "undefined") {
        Object.defineProperty(window, "MediaRecorder", {
          configurable: true,
          value: class {
            static isTypeSupported = () => true;
          },
        });
      }
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(new DOMException("stubbed", name)),
          enumerateDevices: () => Promise.resolve([]),
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
      });
    }, error);
    await page.goto("/record");
    await page.getByRole("button", { name: "Turn on camera" }).click();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByRole("link", { name: "Upload a file instead" })).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
    await expectNoSeriousAxeIssues(page);
  });
}
