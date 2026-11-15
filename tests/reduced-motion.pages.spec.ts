import { expect as baseExpect, test } from "@playwright/test";
import { builtWorkerSetting } from "./support/built-env";
import { expectNoMotion } from "./support/motion";
import { INSIGHTS_TEST_VIEWER_ID, signIn } from "./support/session";
import { cleanups, open, setup } from "./fixtures/background-take-page";

// B2-T162 (launch UI review item 4), the rest of the main pages. With reduced motion on, nothing
// is still animating or transitioning after load and after each dialog opens: the take page's
// Background pane and delete dialog, /record's script step, sign in, Privacy, Terms, not found
// and /insights for the test viewer. The library, a take page and /record are in
// `reduced-motion.spec.ts`. Synthetic fixtures only.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

for (const path of ["/sign-in", "/privacy", "/terms", "/no-such-page"]) {
  test(`no running animation on ${path} when signed out`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoMotion(page);
  });
}

test("no running animation on the take page, its Background pane or its delete dialog", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await open(page, id);
  await expectNoMotion(page);
  await page.getByRole("button", { name: "More actions for this take" }).click();
  await page.getByRole("menuitem", { name: "Delete Interview" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoMotion(page);
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expectNoMotion(page);
});

test("no running animation on /record's script step with a script and the voice consent", async ({
  page,
  baseURL,
}) => {
  const { cleanup } = await signIn(page.context(), baseURL ?? "");
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  await page.goto("/record");
  await page.getByLabel("Script (optional)").fill("Hello to the lens");
  await expectNoMotion(page);
  await page.getByRole("switch", { name: "Follow my voice" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoMotion(page);
});

test.describe("/insights", () => {
  test("no running animation for the test viewer", async ({ page, baseURL }) => {
    const configured = builtWorkerSetting("INSIGHTS_VIEWER_USER_ID") === INSIGHTS_TEST_VIEWER_ID;
    if (process.env.CI) expect(configured, "the build must set INSIGHTS_VIEWER_USER_ID").toBe(true);
    else test.skip(!configured, "the Worker was not built with the test viewer id");
    const { cleanup } = await signIn(
      page.context(),
      baseURL ?? "",
      "Insights Viewer",
      INSIGHTS_TEST_VIEWER_ID,
    );
    cleanups.push(cleanup);
    await page.goto("/insights");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoMotion(page);
  });
});
