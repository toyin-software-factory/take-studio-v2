import { devices, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import {
  READY,
  View,
  cleanups,
  expect,
  openTranscript,
  readyTake,
  serve,
} from "./fixtures/transcript";

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

const sizes = [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: devices["iPhone 13"].viewport.width, height: 800 }],
] as const;

test.describe("states", () => {
  const states: readonly [string, View, string | RegExp][] = [
    ["making", { state: "making", canMake: false }, "Making your transcript"],
    ["none and can make", { state: "none", canMake: true }, "Make transcript"],
    ["none and cannot make", { state: "none", canMake: false }, "No transcript for this take"],
    ["failed", { state: "failed", canMake: true }, /The transcript didn.t finish/],
    [
      "not English",
      { state: "skipped", reason: "not_english", canMake: false },
      "English only for now",
    ],
    [
      "no speech",
      { state: "skipped", reason: "no_speech", canMake: false },
      "No speech found in this take",
    ],
    [
      "video expired",
      { state: "skipped", reason: "original_gone", canMake: false },
      "video has expired",
    ],
    [
      "ready, no words",
      { state: "ready", canMake: false, version: "v1", paragraphs: [] },
      "No words in the trimmed video",
    ],
    ["ready", READY, "second paragraph here"],
  ];
  for (const [name, view, text] of states) {
    for (const [size, viewport] of sizes) {
      test(`${name} at ${size}: shown, no sideways scroll, axe clean`, async ({
        page,
        baseURL,
      }) => {
        await page.setViewportSize(viewport);
        const id = await readyTake(page, baseURL!);
        await serve(page, [view]);
        await openTranscript(page, id);
        const panel = page.getByRole("region", { name: "Transcript" });
        await expect(panel).toContainText(text);
        if (name === "failed")
          await expect(panel.getByRole("button", { name: "Try again" })).toBeVisible();
        if (name === "none and can make")
          await expect(panel.getByRole("button", { name: "Make transcript" })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        await expectNoSeriousAxeIssues(page);
      });
    }
  }

  test("making turns into the transcript without a reload", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [{ state: "making", canMake: false }, READY]);
    await openTranscript(page, id);
    await expect(page.getByText("Making your transcript")).toBeVisible();
    await expect(page.getByText("second paragraph here")).toBeVisible();
    await expect(page.getByText("Making your transcript")).toBeHidden();
  });

  test("Make transcript starts the job and shows it being made", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    let started = false;
    await page.route(/\/api\/takes\/[^/]+\/transcript$/, (route) => {
      if (route.request().method() === "POST") {
        started = true;
        return route.fulfill({ status: 202, json: { state: "making" } });
      }
      // Like the server: once the job exists, the read says it is being made.
      return route.fulfill({ json: { state: started ? "making" : "none", canMake: !started } });
    });
    await openTranscript(page, id);
    await page.getByRole("button", { name: "Make transcript" }).click();
    await expect(page.getByText("Making your transcript")).toBeVisible();
  });
});

test.describe("kept behaviour of the panel", () => {
  test("a load error shows beside a transcript that already loaded", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [{ state: "making", canMake: false }, 500]);
    await openTranscript(page, id);
    await expect(page.getByText(/We couldn.t load the transcript/)).toBeVisible();
    await expect(page.getByText("Making your transcript")).toBeVisible();
  });

  test("a 404 while making ends the checking: no stale 'making', no promise of retries", async ({
    page,
    baseURL,
  }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [{ state: "making", canMake: false }, 404]);
    await openTranscript(page, id);
    await expect(page.getByText("Making your transcript")).toBeVisible();
    await expect(page.getByText(/can.t check on the transcript any more/)).toBeVisible();
    await expect(page.getByText("Making your transcript")).toHaveCount(0);
    await expect(page.getByText("keep trying")).toHaveCount(0);
  });

  test("no 'we'll keep trying' after a 404", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [404]);
    await openTranscript(page, id);
    await expect(page.getByRole("heading", { name: "Interview" })).toBeVisible();
    await expect(page.getByText("keep trying")).toHaveCount(0);
  });

  test("an actionable start refusal stays until the creator acts; the 'still being made' note goes once final", async ({
    page,
    baseURL,
  }) => {
    const id = await readyTake(page, baseURL!);
    const refusals = [
      {
        status: 409,
        json: {
          error: "original_gone",
          message: "This take's video has expired, so a transcript can't be made.",
        },
      },
    ];
    let posts = 0;
    await page.route(/\/api\/takes\/[^/]+\/transcript$/, (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        return route.fulfill(refusals[0]!);
      }
      return route.fulfill({ json: { state: "none", canMake: true } });
    });
    await openTranscript(page, id);
    await page.getByRole("button", { name: "Make transcript" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "can't be made" })).toBeVisible();
    // The poll keeps reading `none`; the refusal is not cleared by it.
    await page.waitForTimeout(100);
    await expect(page.getByRole("alert").filter({ hasText: "can't be made" })).toBeVisible();
    expect(posts).toBe(1);
  });
});
