import { expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";

// The teleprompter on /record (spec 0021 task 2: AC-2 and the prompter part of AC-9). Chromium's
// fake camera and microphone stand in for a device. Real phones are listed for /check verify.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const SCRIPT = Array.from(
  { length: 12 },
  (_, i) => `Line ${i + 1} of my script goes right here.`,
).join("\n");

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function open(page: Page, baseURL: string) {
  const { cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  await page.goto("/record");
}

async function toStage(page: Page, script = SCRIPT) {
  await page.getByLabel("Script (optional)").fill(script);
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
}

test("pause, speed and size work with buttons and keys; the recording never pauses (AC-2, AC-9)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await toStage(page);
  const controls = page.getByTestId("prompter-controls");
  await expect(controls).toBeVisible();
  await expect(page.getByTestId("prompter-speed")).toHaveText("140 wpm");
  await expect(page.getByTestId("prompter-size")).toHaveText("44 px");
  await expectNoSeriousAxeIssues(page);

  await page.getByRole("button", { name: "Faster" }).click();
  await expect(page.getByTestId("prompter-speed")).toHaveText("150 wpm");
  await page.getByRole("button", { name: "Larger text" }).click();
  await expect(page.getByTestId("prompter-size")).toHaveText("54 px");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("prompter-speed")).toHaveText("130 wpm");
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await expect(page.getByTestId("prompter-size")).toHaveText("36 px");

  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await expectNoSeriousAxeIssues(page);

  // The text sits in the top half of the preview.
  const text = await page.getByTestId("script-scroll").boundingBox();
  const video = await page.getByLabel("Camera preview").boundingBox();
  expect(text!.y).toBeLessThan(video!.y + video!.height / 2);

  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: "Resume script" })).toBeVisible();
  await expect(page.getByTestId("script-scroll")).toHaveAttribute("data-paused", "true");
  const before = await page.getByTestId("record-timer").innerText();
  await page.waitForTimeout(1500);
  expect(await page.getByTestId("record-timer").innerText()).not.toBe(before);
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Resume script" }).click();
  await expect(page.getByRole("button", { name: "Pause script" })).toBeVisible();
});

test("shortcuts never fire while a text field has focus (AC-9)", async ({ page, baseURL }) => {
  await open(page, baseURL!);
  const field = page.getByLabel("Script (optional)");
  await field.click();
  await page.keyboard.type("plan - a +b ");
  await expect(field).toHaveValue("plan - a +b ");
});

test("speed, size and the script draft are remembered on the device (AC-2)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await toStage(page);
  await page.getByRole("button", { name: "Faster" }).click();
  await page.getByRole("button", { name: "Larger text" }).click();

  await page.reload();
  await expect(page.getByLabel("Script (optional)")).toHaveValue(SCRIPT);
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByTestId("prompter-speed")).toHaveText("150 wpm");
  await expect(page.getByTestId("prompter-size")).toHaveText("54 px");
});

test("reduced motion steps by line with a highlight (AC-9)", async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, baseURL!);
  await toStage(page);
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await expect(page.locator("[data-testid=script-scroll] [data-current=true]")).toHaveCount(1);
  await expectNoSeriousAxeIssues(page);
});

test("no script means no prompter (AC-2)", async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
  await expect(page.getByTestId("script-scroll")).toHaveCount(0);
  await expect(page.getByTestId("prompter-controls")).toHaveCount(0);
});

test("the Record step has the prompter with its green line, the dock and the Script and camera panel (B2-T128)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await toStage(page);
  const stage = page.locator('[data-check="s2-stage"]');
  const text = page.locator(".rst-prompter");
  await expect(text).toBeVisible();
  await expect(text.locator(".rst-line")).toHaveCount(1);
  await expect(text).toHaveAttribute("data-paused", "false");

  // The dock holds flip, pause and Record; the panel holds the settings, not the pause button.
  const pause = page.locator('[data-check="s2-stage-cta-4"]');
  await expect(pause).toHaveAccessibleName("Pause script");
  await expect(page.locator(".rst-rec")).toHaveAccessibleName("Record");
  await expect(page.locator(".rst-panel").getByTestId("prompter-toggle")).toHaveCount(0);
  const heading = page.locator('[data-check="s2-stage-heading"]');
  await expect(heading).toHaveText("Script and camera");
  await expect(page.locator(".rst-panel")).toContainText("Follow my voice");
  await expect(stage.locator('[data-check="s2-stage-media"]')).toBeVisible();

  await pause.click();
  await expect(pause).toHaveAccessibleName("Resume script");
  await expect(text).toHaveAttribute("data-paused", "true");
  await expectNoSeriousAxeIssues(page);
});

async function toReview(page: Page) {
  await toStage(page);
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.locator('[data-check="s2-stage-cta-2"]')).toBeVisible();
}

test("the Review step has the Your take panel, big play and the three actions (B2-T129)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await toReview(page);
  await expect(page.locator('[data-check="s2-stage"]')).toBeVisible();
  await expect(page.locator('[data-check="s2-stage-media"]')).toBeVisible();
  await expect(page.locator('[data-check="s2-stage-heading-2"]')).toContainText(
    "recorded. Nothing has left this device yet.",
  );
  await expect(page.locator('[data-check="s2-stage-cta-2"]')).toHaveAccessibleName("Use this take");
  await expect(page.getByRole("button", { name: "Record again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Save to device" })).toBeVisible();
  await expect(page.getByText("we cut the pauses, add your studio")).toBeVisible();
  await expectNoSeriousAxeIssues(page);

  const video = page.getByLabel("Your recording");
  await expect(video).not.toHaveAttribute("controls", "");
  await page.getByRole("button", { name: "Play your take" }).click();
  await expect(page.getByRole("button", { name: "Play your take" })).toHaveCount(0);
  await expect(video).toHaveAttribute("controls", "");
});

test("the Review step shows progress and Cancel while a take uploads (B2-T129)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await page.route("**/api/uploads", () => new Promise(() => {})); // never answers: stays sending
  await toReview(page);
  await page.locator('[data-check="s2-stage-cta-2"]').click();
  await expect(page.locator('[data-check="s2-stage-heading-2"]')).toContainText("Sending it now.");
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByText("Uploading. Keep this tab open.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this take" })).toHaveCount(0);
  await expectNoSeriousAxeIssues(page);
});
