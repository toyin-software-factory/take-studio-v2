import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";
import lighthouse from "lighthouse";
import { signIn } from "../tests/support/session";
import { seedTakes, seedTranscript } from "../tests/support/takes";

/**
 * Lighthouse mobile run (B2-T106), CI and local preview only. Measures LCP, CLS and TBT on the
 * landing page, sign in, library, one seeded ready take and /record, against the built Worker
 * (`pnpm build:worker`, then `opennextjs-cloudflare preview` on 127.0.0.1:8787).
 *
 * Report only: a slow page never fails the run. It fails when a page errors or does not load
 * (Lighthouse runtime error, an HTTP error, a redirect away from the page, or no metric at all).
 * Synthetic data only: a made up user and take in the CI Postgres (the same guard as the e2e
 * tests), never a production sign in. Reports go to `lighthouse-reports/`, the table to the job
 * summary and to stdout.
 *
 * Profile: Lighthouse's mobile defaults written out (Moto G Power sized screen, simulated slow 4G
 * at 150 ms round trip and 1.6 Mbps down, 4x CPU slowdown). Each page runs `LH_RUNS` times (3)
 * and the median of each metric is reported.
 */

const BASE = process.env.LH_BASE_URL ?? "http://127.0.0.1:8787";
const RUNS = Number(process.env.LH_RUNS ?? "3");
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error(`::error::LH_RUNS must be a positive whole number, got "${process.env.LH_RUNS}".`);
  process.exit(1);
}
const PORT = 9333;
const OUT = "lighthouse-reports";

type Page = { readonly name: string; readonly path: string; readonly signedIn: boolean };

const METRICS = [
  { key: "lcp", audit: "largest-contentful-paint" },
  { key: "cls", audit: "cumulative-layout-shift" },
  { key: "tbt", audit: "total-blocking-time" },
  { key: "fcp", audit: "first-contentful-paint" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];
type Sample = Readonly<Record<MetricKey, number>> & { readonly score: number };

type Lhr = {
  readonly runtimeError?: { readonly code: string };
  readonly finalDisplayedUrl: string;
  readonly categories: { readonly performance: { readonly score: number | null } };
  readonly audits: Readonly<
    Record<string, { readonly numericValue?: number; readonly details?: unknown }>
  >;
};

const SETTINGS = {
  port: PORT,
  logLevel: "error" as const,
  output: ["json", "html"] as ("json" | "html")[],
  onlyCategories: ["performance"],
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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The status of the page's own request, from Lighthouse's network audit. */
function documentStatus(lhr: Lhr): number | null {
  const details = lhr.audits["network-requests"]?.details as
    { items?: readonly { statusCode?: number }[] } | undefined;
  return details?.items?.[0]?.statusCode ?? null;
}

/** Why this run does not count as "the page loaded", or null. */
function loadProblem(lhr: Lhr, page: Page): string | null {
  if (lhr.runtimeError) return `Lighthouse error ${lhr.runtimeError.code}`;
  const final = new URL(lhr.finalDisplayedUrl);
  if (final.origin !== new URL(BASE).origin) return `redirected to ${final.origin}`;
  if (final.pathname !== page.path) return `redirected to ${final.pathname}`;
  const status = documentStatus(lhr);
  if (status !== null && status >= 400) return `HTTP ${status}`;
  if (typeof lhr.categories.performance.score !== "number") return "no performance score";
  for (const { audit } of METRICS) {
    if (typeof lhr.audits[audit]?.numericValue !== "number") return `no ${audit} value`;
  }
  return null;
}

function sample(lhr: Lhr): Sample {
  const read = (audit: string) => lhr.audits[audit]!.numericValue!;
  return {
    lcp: read("largest-contentful-paint"),
    cls: read("cumulative-layout-shift"),
    tbt: read("total-blocking-time"),
    fcp: read("first-contentful-paint"),
    score: lhr.categories.performance.score!,
  };
}

type Result =
  | { readonly page: Page; readonly ok: true; readonly median: Sample }
  | { readonly page: Page; readonly ok: false; readonly problem: string };

async function measure(page: Page): Promise<Result> {
  const samples: Sample[] = [];
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
  }
  const med = (key: keyof Sample) => median(samples.map((s) => s[key]));
  return {
    page,
    ok: true,
    median: {
      lcp: med("lcp"),
      cls: med("cls"),
      tbt: med("tbt"),
      fcp: med("fcp"),
      score: med("score"),
    },
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const millis = (ms: number) => `${Math.round(ms)} ms`;

function table(results: readonly Result[]): string {
  const rows = results.map((r) =>
    r.ok
      ? `| ${r.page.name} \`${r.page.path.replace(/[0-9a-f-]{36}/, ":id")}\` | ${seconds(r.median.lcp)} | ${r.median.cls.toFixed(3)} | ${millis(r.median.tbt)} | ${seconds(r.median.fcp)} | ${Math.round(r.median.score * 100)} |`
      : `| ${r.page.name} | FAILED: ${r.problem} | | | | |`,
  );
  return [
    `## Lighthouse mobile (median of ${RUNS} runs)`,
    "",
    "Simulated slow 4G, 4x CPU slowdown, mobile screen. Report only: a score never fails the build, an error or a page that does not load does. The runner is shared, so read differences of a few percent as noise.",
    "",
    "| Page | LCP | CLS | TBT | FCP | Score |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    "The take page uses a seeded ready take whose video files do not exist in the CI bucket, so the player shows its own unavailable state. Reports (HTML and JSON) are in the `lighthouse-reports` artifact.",
    "",
  ].join("\n");
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
    { name: "Landing", path: "/", signedIn: false },
    { name: "Sign in", path: "/sign-in", signedIn: false },
  ] satisfies Page[]) {
    results.push(await measure(page));
  }
  const { user, cleanup } = await signIn(context, BASE, "Lighthouse Tester");
  try {
    const takeId = await seedReadyTake(user.id);
    for (const page of [
      { name: "Library", path: "/library", signedIn: true },
      { name: "Take page", path: `/takes/${takeId}`, signedIn: true },
      { name: "Record", path: "/record", signedIn: true },
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
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
