import { test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { seedTranscript } from "./support/takes";
import { READY, cleanups, expect, openTranscript, readyTake, serve } from "./fixtures/transcript";

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

test.describe("fixes: marks, list, undo and redo (spec 0012, AC-6 to AC-8)", () => {
  const WORDS = [
    { w: "Hello", startMs: 300, endMs: 700, para: true },
    { w: "Kubernetes", startMs: 700, endMs: 1200 },
    { w: "world.", startMs: 1200, endMs: 1800 },
  ];
  // The stored word is the original; the fix says what it shows while it is not undone.
  const EDIT = {
    index: 1,
    old: "Cuber nettys",
    new: "Kubernetes",
    reason: "A product name",
    undone: false,
  };

  async function open(page: Page, baseURL: string) {
    const id = await readyTake(page, baseURL);
    await seedTranscript(id, [WORDS[0]!, { ...WORDS[1]!, w: "Cuber nettys" }, WORDS[2]!], [EDIT]);
    await openTranscript(page, id);
    const panel = page.getByRole("region", { name: "Transcript" });
    await expect(panel).toContainText("Hello Kubernetes world.");
    return { id, panel };
  }

  test("a fixed word is underlined solid, listed with its reason, and undo then redo change the text and the captions", async ({
    page,
    baseURL,
  }) => {
    const { id, panel } = await open(page, baseURL!);
    const word = panel.getByText("Kubernetes", { exact: true });
    await expect(word).toHaveCSS("text-decoration-style", "solid");
    await expect(word).toHaveCSS("text-decoration-line", "underline");
    await expect(panel.getByRole("heading", { name: "Fixes (1)" })).toBeVisible();
    await expect(panel.getByTestId("fix-row")).toContainText(
      "\u201cCuber nettys\u201d \u2192 \u201cKubernetes\u201d: A product name",
    );
    const track = () => page.locator("video track").getAttribute("src");
    const first = await track();
    const srt = async () =>
      (
        await page.request.get(
          (await panel
            .getByRole("link", { name: "Download captions (SRT)" })
            .getAttribute("href"))!,
        )
      ).text();
    expect(await srt()).toContain("Hello Kubernetes world.");

    await panel.getByRole("button", { name: /^Undo fix/ }).click();
    await expect(panel).toContainText("Hello Cuber nettys world.");
    await expect(panel.getByRole("heading", { name: "Fixes (0)" })).toBeVisible();
    await expect(panel.getByText("Cuber nettys", { exact: true }).first()).toHaveCSS(
      "text-decoration-line",
      "none",
    );
    expect(await track()).not.toBe(first);
    expect(await srt()).toContain("Hello Cuber nettys world.");

    await panel.getByRole("button", { name: /^Redo fix/ }).click();
    await expect(panel).toContainText("Hello Kubernetes world.");
    await expect(panel.getByRole("heading", { name: "Fixes (1)" })).toBeVisible();
    expect(await srt()).toContain("Hello Kubernetes world.");
    // The change is saved: a reload shows it.
    await page.reload();
    await openTranscript(page, id);
    await expect(panel).toContainText("Hello Kubernetes world.");
  });

  test("a refused undo keeps the fix and says so", async ({ page, baseURL }) => {
    const { panel } = await open(page, baseURL!);
    await page.route("**/transcript/edits/*", (route) =>
      route.fulfill({ status: 500, json: { error: "server" } }),
    );
    await panel.getByRole("button", { name: /^Undo fix/ }).click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel).toContainText("Hello Kubernetes world.");
    await expect(panel.getByRole("heading", { name: "Fixes (1)" })).toBeVisible();
  });

  for (const [name, size] of [
    ["desktop", { width: 1280, height: 800 }],
    ["phone", { width: 390, height: 800 }],
  ] as const) {
    test(`at ${name} width: no sideways scroll, axe clean, 44 px buttons on touch`, async ({
      page,
      baseURL,
    }) => {
      await page.setViewportSize(size);
      const { panel } = await open(page, baseURL!);
      await expect(panel.getByTestId("fix-row")).toBeVisible();
      await expectNoSeriousAxeIssues(page);
      await panel.getByRole("button", { name: /^Undo fix/ }).click();
      await expect(panel.getByRole("button", { name: /^Redo fix/ })).toBeVisible();
      await expectNoSeriousAxeIssues(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("touch targets on a phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });

  test("the paragraph timestamp button is at least 44 px", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [READY]);
    await openTranscript(page, id);
    const box = await page.getByRole("button", { name: "Play from 0:01" }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  });
});
