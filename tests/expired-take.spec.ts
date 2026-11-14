import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes, seedTranscript } from "./support/takes";

// Expiry wording and the expired take page (spec 0013 AC-1, AC-2): the video is gone, the
// transcript stays, Rename and Delete keep working, nothing asks for a video link.

const expect = baseExpect.configure({ timeout: 15_000 });

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

const steps = [
  { name: "trim", status: "succeeded" },
  { name: "render", status: "succeeded" },
] as const;

async function seedExpired(page: Page, baseURL: string): Promise<string> {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  const [id] = await seedTakes(user.id, [
    { title: "Old take", status: "ready", durationMs: 20_000, expiresInDays: -2, steps },
  ]);
  await seedTranscript(id!, [
    { w: "Hello", startMs: 0, endMs: 400 },
    { w: "there", startMs: 400, endMs: 800 },
  ]);
  return id!;
}

function suite() {
  test("an expired take says the video was removed, keeps the transcript, offers no video", async ({
    page,
    baseURL,
  }) => {
    const id = await seedExpired(page, baseURL!);
    await page.goto(`/takes/${id}`);
    const main = page.getByRole("main");
    await expect(main.getByText(/Video removed on \d{1,2} [A-Z][a-z]{2}/).first()).toBeVisible();
    await expect(main.getByText("Your transcript is kept.").first()).toBeVisible();
    await expect(main.getByText("Videos are kept for 30 days.")).toBeVisible();
    // No player, no video links or buttons (AC-2).
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download original" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save edited video" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save original video" })).toHaveCount(0);
    // The transcript downloads and Rename remain.
    await expect(main.getByRole("link", { name: "Save captions (SRT)" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
    await expectNoSeriousAxeIssues(page);
  });

  test("the library card says Video removed on a date, transcript kept", async ({
    page,
    baseURL,
  }) => {
    await seedExpired(page, baseURL!);
    await page.goto("/library");
    const card = page.getByRole("main").getByRole("listitem").filter({ hasText: "Old take" });
    await expect(
      card.getByText(/^Video removed on \d{1,2} [A-Z][a-z]{2}\. Your transcript is kept\.$/),
    ).toBeVisible();
    await expectNoSeriousAxeIssues(page);
  });
}

test.describe("desktop", suite);

test.describe("phone width", () => {
  // `defaultBrowserType` cannot be set inside a describe group, so it is left out.
  const pixel: Record<string, unknown> = { ...devices["Pixel 7"] };
  delete pixel.defaultBrowserType;
  test.use(pixel);
  suite();
});
