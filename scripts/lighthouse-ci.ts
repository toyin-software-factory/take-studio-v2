import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";
import lighthouse from "lighthouse";
import { signIn } from "../tests/support/session";
import { type GatePage, gateViolations } from "./lighthouse-gate";
import {
  CATEGORIES,
  type FailedAudit,
  type Lhr,
  type MetricKey,
  type Page,
  type Result,
  type Sample,
  failedAudits,
  loadProblem,
  median,
  medianOrNull,
  sample,
} from "./lighthouse-lhr";
import { BASE, OUT, PORT, RUNS } from "./lighthouse-config";
import { table } from "./lighthouse-report";
import { seedTakes, seedTranscript } from "../tests/support/takes";

/**
 * Lighthouse mobile run (B2-T106, B2-T111), CI and local preview only. Measures LCP, CLS and TBT,
 * and scores accessibility, best practices and SEO, on the landing page, sign in, library, one seeded ready take and /record, against the built Worker
 * (`pnpm build:worker`, then `opennextjs-cloudflare preview` on 127.0.0.1:8787).
 *
 * Gated since B2-T114 on accessibility, best practices and SEO (`scripts/lighthouse-gate.ts`: 100s on the
 * landing page, 100s in accessibility and best practices and `is-crawlable` as the one SEO failure on the
 * noindex pages). Performance stays report only: a slow page never fails the run. It also fails when a page
 * errors or does not load (Lighthouse runtime error, an HTTP error, a redirect away from the page, or no metric at all).
 * The seeded take's thumbnail and play file come from committed synthetic fixtures (`serveSyntheticMedia`),
 * so a console error on the take page is a real one.
 * Synthetic data only: a made up user and take in the CI Postgres (the same guard as the e2e
 * tests), never a production sign in. Reports go to `lighthouse-reports/`, the table to the job
 * summary and to stdout.
 *
 * Profile: Lighthouse's mobile defaults written out (Moto G Power sized screen, simulated slow 4G
 * at 150 ms round trip and 1.6 Mbps down, 4x CPU slowdown). Each page runs `LH_RUNS` times (3)
 * and the median of each metric is reported. Failed audits (any score under 1 in the four
 * categories, in any run) are listed per page with their item counts, never item contents.
 */

const SETTINGS = {
  port: PORT,
  logLevel: "error" as const,
  output: ["json", "html"] as ("json" | "html")[],
  onlyCategories: [...CATEGORIES],
  formFactor: "mobile" as const,
  throttlingMethod: "simulate" as const,
  throttling: {
    rttMs: 150,
    throughputKbps: 1638.4,
    requestLatencyMs: 562.5,
    downloadThroughputKbps: 1474.56,
    uploadThroughputKbps: 675,
    cpuSlowdownMultiplier: 4,
  },
};

async function measure(page: Page): Promise<Result> {
  const samples: Sample[] = [];
  const failed = new Map<string, FailedAudit>();
  for (let run = 1; run <= RUNS; run++) {
    const result = await lighthouse(`${BASE}${page.path}`, SETTINGS);
    if (!result) return { page, ok: false, problem: "no Lighthouse result" };
    const lhr = result.lhr as unknown as Lhr;
    const slug = page.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const [json, html] = result.report as string[];
    writeFileSync(join(OUT, `${slug}-run${run}.json`), json!);
    writeFileSync(join(OUT, `${slug}-run${run}.html`), html!);
    const problem = loadProblem(lhr, page);
    if (problem) return { page, ok: false, problem };
    samples.push(sample(lhr));
    for (const audit of failedAudits(lhr)) failed.set(`${audit.category}:${audit.id}`, audit);
  }
  const med = (key: MetricKey) => median(samples.map((s) => s[key]));
  return {
    page,
    ok: true,
    median: {
      lcp: med("lcp"),
      cls: med("cls"),
      tbt: med("tbt"),
      fcp: med("fcp"),
      scores: {
        performance: median(samples.map((x) => x.scores.performance)),
        accessibility: medianOrNull(samples.map((x) => x.scores.accessibility)),
        "best-practices": medianOrNull(samples.map((x) => x.scores["best-practices"])),
        seo: medianOrNull(samples.map((x) => x.scores.seo)),
      },
    },
    failed: [...failed.values()],
  };
}

function gatePage(result: Result): readonly GatePage[] {
  if (!result.ok) return [];
  const { scores } = result.median;
  return [
    {
      name: result.page.name,
      indexable: result.page.indexable,
      scores: {
        accessibility: scores.accessibility,
        "best-practices": scores["best-practices"],
        seo: scores.seo,
      },
      failedSeoAudits: result.failed.filter((a) => a.category === "seo").map((a) => a.id),
    },
  ];
}

const MEDIA_HOST = "https://media.lighthouse.test";
const CLIP = readFileSync("tests/fixtures/clip.mp4");
const THUMB = readFileSync("tests/fixtures/media/bg-small.jpg");
const CORS = { "access-control-allow-origin": "*", "accept-ranges": "bytes" };

/**
 * The CI bucket is a placeholder, so the media route answers 503 for the seeded take. Answer the
 * route with a link to a made up host and serve that host from the committed synthetic fixtures
 * (a 30 KB clip and a 3 KB image). The routes sit on the browser context, which is the one
 * Lighthouse's tab belongs to; they touch nothing on the server.
 */
async function serveSyntheticMedia(context: BrowserContext): Promise<void> {
  await context.route("**/api/takes/*/media?*", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind");
    const file = kind === "thumb" ? "thumb.jpg" : "clip.mp4";
    return route.fulfill({ json: { url: `${MEDIA_HOST}/${file}`, expiresInSeconds: 3600 } });
  });
  await context.route(`${MEDIA_HOST}/**`, (route) => {
    if (route.request().url().endsWith("/thumb.jpg")) {
      return route.fulfill({ body: THUMB, contentType: "image/jpeg", headers: CORS });
    }
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
    if (!range) return route.fulfill({ body: CLIP, contentType: "video/mp4", headers: CORS });
    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : CLIP.length - 1, CLIP.length - 1);
    return route.fulfill({
      status: 206,
      body: CLIP.subarray(start, end + 1),
      contentType: "video/mp4",
      headers: { ...CORS, "content-range": `bytes ${start}-${end}/${CLIP.length}` },
    });
  });
}

async function seedReadyTake(userId: string): Promise<string> {
  const [takeId] = await seedTakes(userId, [
    {
      title: "Lighthouse take",
      status: "ready",
      durationMs: 12_000,
      steps: [
        { name: "trim", status: "succeeded", progress: 100 },
        { name: "render", status: "succeeded", progress: 100 },
      ],
      removedRanges: [{ startMs: 4_000, endMs: 4_800 }],
    },
  ]);
  const words = "Hello and welcome to this synthetic take for the speed check".split(" ");
  await seedTranscript(
    takeId!,
    words.map((w, i) => ({ w, startMs: i * 900, endMs: i * 900 + 700 })),
  );
  return takeId!;
}

async function run(context: BrowserContext): Promise<readonly Result[]> {
  const results: Result[] = [];
  // Signed out first: the landing page sends a signed in visitor to /library.
  for (const page of [
    { name: "Landing", path: "/", signedIn: false, indexable: true },
    { name: "Sign in", path: "/sign-in", signedIn: false, indexable: false },
  ] satisfies Page[]) {
    results.push(await measure(page));
  }
  const { user, cleanup } = await signIn(context, BASE, "Lighthouse Tester");
  try {
    const takeId = await seedReadyTake(user.id);
    await serveSyntheticMedia(context);
    for (const page of [
      { name: "Library", path: "/library", signedIn: true, indexable: false },
      { name: "Take page", path: `/takes/${takeId}`, signedIn: true, indexable: false },
      { name: "Record", path: "/record", signedIn: true, indexable: false },
    ] satisfies Page[]) {
      results.push(await measure(page));
    }
  } finally {
    await cleanup();
  }
  return results;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "lh-profile-"));
  // A persistent context is the browser's default context, the one Lighthouse's own tab uses, so
  // the session cookie set through Playwright is sent on its loads.
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--remote-debugging-port=${PORT}`],
  });
  let results: readonly Result[] = [];
  try {
    results = await run(context);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
  const markdown = table(results);
  writeFileSync(join(OUT, "summary.md"), markdown);
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(results, null, 2));
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`::error::${failed.length} page(s) did not load cleanly under Lighthouse.`);
    process.exit(1);
  }
  const violations = gateViolations(results.flatMap(gatePage));
  if (violations.length > 0) {
    for (const line of violations) console.error(`::error::Lighthouse gate: ${line}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
