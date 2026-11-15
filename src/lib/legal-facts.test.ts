import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEEPGRAM_OPTIONS, deepgramUrl } from "./deepgram";
import {
  aiEditEnvSchema,
  emailEnvSchema,
  jobEnvSchema,
  realtimeEnvSchema,
  transcriptEnvSchema,
  usageEnvSchema,
  webEnvSchema,
} from "./env";
import {
  COLLECTED,
  COOKIES,
  LEGAL_NUMBERS,
  NON_DATA_PACKAGES,
  NON_PROCESSOR_ENV,
  PROCESSORS,
  PUBLIC_VIEWER,
} from "./legal-facts";
import { minimalDataCollection, sentryOptions, workerSentryOptions } from "./sentry-options";
import { MEDIA_LIMITS, VIDEO_RETENTION_DAYS } from "./take-rules";
import { monthlyAllowanceSeconds, parseUsageSettings } from "./usage-rules";

/** Spec 0015 AC-9: the legal facts stay true because these tests tie them to the code. */
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
};
const SECRET_SCHEMAS = [
  webEnvSchema,
  jobEnvSchema,
  usageEnvSchema,
  emailEnvSchema,
  transcriptEnvSchema,
  aiEditEnvSchema,
  realtimeEnvSchema,
];
const schemaNames = new Set(SECRET_SCHEMAS.flatMap((s) => Object.keys(s.shape)));
const registryEnv = new Set(
  PROCESSORS.flatMap((p) => p.envNames),
); /** Spec 0005 AC-4: every category off, written out so a flip inside the helper cannot pass. */
const ALL_OFF = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};
describe("processor registry and env schemas", () => {
  it("covers every env name: a processor secret or a known own secret", () => {
    const unknown = [...schemaNames].filter(
      (name) => !registryEnv.has(name) && !NON_PROCESSOR_ENV.includes(name),
    );
    expect(unknown, "add a PROCESSORS entry (or NON_PROCESSOR_ENV) for these").toEqual([]);
  });

  it("names no env variable that the schemas do not have, except the optional Sentry DSN", () => {
    const stale = [...registryEnv].filter(
      (name) => !schemaNames.has(name) && name !== "SENTRY_DSN",
    );
    expect(stale).toEqual([]);
    expect(NON_PROCESSOR_ENV.filter((name) => !schemaNames.has(name))).toEqual([]);
  });

  it("lists the eight services, once each, none training on content", () => {
    expect(PROCESSORS.map((p) => p.id)).toEqual([
      "cloudflare",
      "neon",
      "trigger",
      "deepgram",
      "anthropic",
      "resend",
      "sentry",
      "google",
    ]);
    expect(new Set(PROCESSORS.map((p) => p.id)).size).toBe(PROCESSORS.length);
    for (const p of PROCESSORS) {
      expect(p.trainsOnContent).toBe(false);
      expect(p.receives.length).toBeGreaterThan(0);
      expect(p.doesNotReceive.length).toBeGreaterThan(0);
    }
  });

  it("says Anthropic gets words and positions, never video or audio", () => {
    const anthropic = PROCESSORS.find((p) => p.id === "anthropic")!;
    expect(anthropic.receives).toMatch(/words/i);
    expect(anthropic.doesNotReceive).toMatch(/video or audio/i);
  });
});
describe("dependencies", () => {
  const runtime = Object.keys(pkg.dependencies);
  const registered = new Set(PROCESSORS.flatMap((p) => p.packages));

  it("has no runtime dependency outside the registry and the allowlist", () => {
    const unknown = runtime.filter(
      (name) => !registered.has(name) && !NON_DATA_PACKAGES.includes(name),
    );
    expect(unknown, "register the service in PROCESSORS or allowlist the tool").toEqual([]);
  });

  it("keeps no stale entries", () => {
    expect([...registered, ...NON_DATA_PACKAGES].filter((n) => !runtime.includes(n))).toEqual([]);
    expect(NON_DATA_PACKAGES.filter((n) => registered.has(n))).toEqual([]);
  });
});
describe("promises tied to settings", () => {
  it("keeps Deepgram opted out of training", () => {
    expect(DEEPGRAM_OPTIONS.mip_opt_out).toBe("true");
    expect(new URL(deepgramUrl()).searchParams.get("mip_opt_out")).toBe("true");
  });

  it("never turns Sentry personal data on", () => {
    for (const runtime of ["web", "browser", "jobs"] as const) {
      const options = sentryOptions({
        dsn: "https://k@o.ingest.sentry.io/1",
        environment: "production",
        runtime,
      });
      expect(options).not.toHaveProperty("sendDefaultPii", true);
      expect(options.dataCollection).toEqual(ALL_OFF);
    }
    const worker = workerSentryOptions({ dsn: undefined, environment: "preview", runtime: "web" });
    expect(worker).not.toHaveProperty("sendDefaultPii", true);
    expect(worker.dataCollection).toEqual(ALL_OFF);
    expect(minimalDataCollection()).toEqual(ALL_OFF);
    const data = minimalDataCollection();
    expect(data.userInfo).toBe(false);
    expect(data.cookies).toBe(false);
    expect(data.httpHeaders).toBe(false);
    expect(data.httpBodies).toEqual([]);
  });

  it("sets no cookie besides the session cookie", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
          const text = readFileSync(path, "utf8");
          if (/document\.cookie|cookies\(\)|\.cookies\.set|[Ss]et-[Cc]ookie\b.*=/.test(text)) {
            hits.push(path);
          }
        }
      }
    };
    walk("src");
    // Sentry's own scrubbing mentions "cookie" as text only; nothing may set one.
    expect(hits.filter((p) => !p.includes("sentry-"))).toEqual([]);
    expect(COOKIES.map((c) => c.name)).toEqual(["better-auth.session_token"]);
  });
});
describe("numbers come from the rule constants", () => {
  it("matches retention and limits", () => {
    expect(LEGAL_NUMBERS.retentionDays).toBe(VIDEO_RETENTION_DAYS);
    expect(LEGAL_NUMBERS.maxMinutes * 60_000).toBe(MEDIA_LIMITS.maxDurationMs);
    expect(LEGAL_NUMBERS.maxGigabytes * 1024 ** 3).toBe(MEDIA_LIMITS.maxBytes);
    expect(LEGAL_NUMBERS.maxLongSide).toBe(MEDIA_LIMITS.maxLongSide);
    expect(LEGAL_NUMBERS.maxShortSide).toBe(MEDIA_LIMITS.maxShortSide);
  });

  it("states the retention in the collected table from the constant", () => {
    const video = COLLECTED.find((c) => c.what.startsWith("Videos"))!;
    expect(video.kept).toContain(`${VIDEO_RETENTION_DAYS} days`);
  });

  it("says the usage count stays after the account is deleted", () => {
    const usage = COLLECTED.find((c) => c.what.startsWith("Usage seconds"))!;
    expect(usage.kept).toMatch(/after the account is deleted/i);
  });

  it("uses a fixed public viewer, so the allowance cannot vary by reader", () => {
    const settings = parseUsageSettings({ free_monthly_seconds: 7200, usage_limit_enabled: true });
    expect(monthlyAllowanceSeconds(settings, PUBLIC_VIEWER)).toBe(7200);
    expect(PUBLIC_VIEWER.accountHash).toBe("public-viewer");
  });
});
