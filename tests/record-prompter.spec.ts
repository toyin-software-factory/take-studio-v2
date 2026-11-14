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
