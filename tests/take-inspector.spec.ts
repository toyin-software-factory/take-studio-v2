import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// Take page inspector and top bar (spec 0009, AC-5, AC-7): the four tabs, what each shows, the
// keyboard, and the breadcrumb following a rename. Seeded test users and synthetic media only.
const expect = baseExpect.configure({ timeout: 15_000 });
const clip = readFileSync("tests/fixtures/clip.mp4");
const R2 = "https://r2.test";

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function seedReady(page: Page, baseURL: string, title: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  const [id] = await seedTakes(user.id, [
    {
      title,
      status: "ready",
      durationMs: 75_000,
      steps: [
        { name: "trim", status: "succeeded" },
        { name: "render", status: "succeeded" },
      ],
      removedRanges: [{ startMs: 1000, endMs: 9000 }],
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
  return id as string;
}

test("a ready take has the four tabs, Export first, with its files and the retention line", async ({
  page,
  baseURL,
}) => {
  const id = await seedReady(page, baseURL!, "Founder intro");
  await page.goto(`/takes/${id}`);
  const tabs = page.getByRole("tablist", { name: "Take tools" });
  await expect(tabs.getByRole("tab")).toHaveText(["Export", "Background", "Transcript", "Details"]);
  await expect(tabs.getByRole("tab", { name: "Export" })).toHaveAttribute("aria-selected", "true");

  const files = page.getByRole("tabpanel", { name: "Export" });
  await expect(files.getByText("Edited video")).toBeVisible();
  await expect(files.getByText("Original video")).toBeVisible();
  await expect(files.getByRole("button", { name: "Save edited video" })).toBeVisible();
  await expect(files.getByRole("button", { name: "Save original video" })).toBeVisible();
  await expect(files.getByText(/^Video expires on \d{1,2} [A-Z][a-z]{2}/)).toBeVisible();
  // The summary row keeps its own two buttons.
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download original" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

test("tabs switch by click and by arrow keys, and only the chosen panel shows", async ({
  page,
  baseURL,
}) => {
  const id = await seedReady(page, baseURL!, "Founder intro");
  await page.goto(`/takes/${id}`);
  await page.getByRole("tab", { name: "Background" }).click();
  await expect(page.getByRole("region", { name: "Background", exact: true })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Export" })).toBeHidden();

  await page.getByRole("tab", { name: "Background" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("region", { name: "Background", exact: true })).toBeHidden();

  await page.getByRole("tab", { name: "Details" }).click();
  const details = page.getByRole("tabpanel", { name: "Details" });
  await expect(details.getByText("Founder intro")).toBeVisible();
  await expect(details.getByText("Format")).toBeVisible();
  await expect(
    details.getByRole("switch", { name: "Email me when takes are ready" }),
  ).toBeVisible();
});

test("the breadcrumb and chip in the top bar follow a rename", async ({ page, baseURL }) => {
  const id = await seedReady(page, baseURL!, "Founder intro");
  await page.goto(`/takes/${id}`);
  const crumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumb.locator("[aria-current=page]")).toHaveText("Founder intro");
  await expect(page.getByRole("banner").getByText("Ready")).toBeVisible();

  await page.getByRole("button", { name: "Rename" }).click();
  const field = page.getByLabel("Title");
  await field.fill("Founder intro, final");
  await field.press("Enter");
  await expect(crumb.locator("[aria-current=page]")).toHaveText("Founder intro, final");
});

test("a take that is not ready has the details only, and the chip says Processing", async ({
  page,
  baseURL,
}) => {
  const { user, cleanup } = await signIn(page.context(), baseURL!);
  cleanups.push(cleanup);
  const [id] = await seedTakes(user.id, [
    {
      title: "Product demo",
      status: "processing",
      durationMs: 30_000,
      steps: [
        { name: "trim", status: "succeeded" },
        { name: "render", status: "running", progress: 40 },
      ],
    },
  ]);
  await page.goto(`/takes/${id}`);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Take details" })).toBeVisible();
  await expect(page.getByRole("banner").getByText("Processing")).toBeVisible();
});

test("a ready take whose video has expired shows Expired in the top bar, not Ready", async ({
  page,
  baseURL,
}) => {
  const { user, cleanup } = await signIn(page.context(), baseURL!);
  cleanups.push(cleanup);
  const [id] = await seedTakes(user.id, [
    {
      title: "Old take",
      status: "ready",
      durationMs: 20_000,
      expiresInDays: -2,
      steps: [
        { name: "trim", status: "succeeded" },
        { name: "render", status: "succeeded" },
      ],
    },
  ]);
  await page.goto(`/takes/${id}`);
  await expect(page.getByRole("banner").getByText("Expired")).toBeVisible();
  await expect(page.getByRole("banner").getByText("Ready")).toHaveCount(0);
});
