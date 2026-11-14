import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEEPGRAM_OPTIONS, deepgramUrl } from "./deepgram";
import {
  aiEditEnvSchema,
  emailEnvSchema,
  jobEnvSchema,
  transcriptEnvSchema,
  usageEnvSchema,
  webEnvSchema,
} from "./env";
import {
  ACCOUNT_DELETE_SELF_SERVE,
  COLLECTED,
  COOKIES,
  LEGAL_ENTITY,
  LEGAL_NUMBERS,
  LEGAL_VERSION,
  type LegalNow,
  NON_DATA_PACKAGES,
  NON_PROCESSOR_ENV,
  PROCESSORS,
  PUBLIC_VIEWER,
  REVIEW,
  type Review,
  draftReasons,
  legalTextHash,
  missingEntityFields,
  normalizeLegalText,
  privacyContactEmail,
} from "./legal-facts";
import { minimalDataCollection, sentryOptions, workerSentryOptions } from "./sentry-options";
import { CONTACT_EMAIL } from "./site";
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
];
const schemaNames = new Set(SECRET_SCHEMAS.flatMap((s) => Object.keys(s.shape)));
const registryEnv = new Set(PROCESSORS.flatMap((p) => p.envNames));

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
    expect(anthropic.doesNotReceive).toMatch(/video, audio/i);
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

/** Spec 0005 AC-4: every category off, written out so a flip inside the helper cannot pass. */
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

describe("version and review", () => {
  it("has ISO dates that are not in the future of the file", () => {
    for (const date of Object.values(LEGAL_VERSION)) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(date))).toBe(false);
    }
  });

  it("hashes the normalized text, so layout changes do not matter but wording does", async () => {
    const a = await legalTextHash("We keep  videos\n30 days.");
    expect(a).toBe(await legalTextHash(" We keep videos 30 days. "));
    expect(a).not.toBe(await legalTextHash("We keep videos 31 days."));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeLegalText(" a \n b ")).toBe("a b");
  });

  const now: LegalNow = {
    privacyTextHash: "p",
    termsTextHash: "t",
    allowance: { minutes: 60, limitEnabled: true },
  };

  it("keeps the Draft banner while Toyin's facts and the review are null", () => {
    expect(missingEntityFields(LEGAL_ENTITY)).toEqual(Object.keys(LEGAL_ENTITY));
    expect(Object.values(REVIEW).every((v) => v === null)).toBe(true);
    expect(
      draftReasons({ entity: LEGAL_ENTITY, review: REVIEW, version: LEGAL_VERSION, now }).length,
    ).toBeGreaterThan(0);
  });

  const entity = {
    name: "Co",
    postalAddress: "1 Road",
    privacyEmail: "p@x.test",
    governingLaw: "Law",
    disputeVenue: "City",
    effectiveDate: "2026-12-01",
  };
  const review: Review = {
    reviewedBy: "Lawyer",
    reviewedOn: "2026-11-30",
    privacyVersion: LEGAL_VERSION.privacy,
    privacyTextHash: "p",
    termsVersion: LEGAL_VERSION.terms,
    termsTextHash: "t",
    allowanceMinutes: 60,
    limitEnabled: true,
  };
  const reasons = (over: Partial<LegalNow>, r: Review = review) =>
    draftReasons({ entity, review: r, version: LEGAL_VERSION, now: { ...now, ...over } });

  it("lets the banner go only when everything matches", () => {
    expect(reasons({})).toEqual([]);
  });

  it("brings it back when a page changed, a version moved or the allowance differs", () => {
    expect(reasons({ privacyTextHash: "x" })).toContain("privacy text changed");
    expect(reasons({ termsTextHash: "x" })).toContain("terms text changed");
    expect(reasons({}, { ...review, termsVersion: "2020-01-01" })).toContain(
      "terms version was not reviewed",
    );
    expect(reasons({ allowance: { minutes: 90, limitEnabled: true } })).toContain(
      "allowance differs from the reviewed one",
    );
    expect(reasons({ allowance: { minutes: 60, limitEnabled: false } }).length).toBe(1);
  });

  it("never passes when the allowance could not be read", () => {
    expect(reasons({ allowance: null })).toContain("allowance could not be read");
  });
});

describe("contact and account deletion", () => {
  it("uses the site contact until Toyin supplies a privacy address", () => {
    expect(privacyContactEmail(LEGAL_ENTITY)).toBe(CONTACT_EMAIL);
    expect(privacyContactEmail({ ...LEGAL_ENTITY, privacyEmail: "p@x.test" })).toBe("p@x.test");
  });

  it("says to email for deletion until the self serve control ships", () => {
    expect(ACCOUNT_DELETE_SELF_SERVE).toBe(false);
  });
});
