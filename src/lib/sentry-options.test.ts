import { describe, expect, it } from "vitest";
import {
  jobFailureTags,
  sentryEnvironment,
  sentryOptions,
  workerSentryOptions,
} from "./sentry-options";

describe("sentryOptions", () => {
  it("is disabled without a DSN (AC-8)", () => {
    const options = sentryOptions({ dsn: undefined, environment: "preview", runtime: "web" });
    expect(options.enabled).toBe(false);
    expect(options.dsn).toBeUndefined();
    expect(sentryOptions({ dsn: "", environment: "preview", runtime: "web" }).enabled).toBe(false);
  });

  it("sends errors only, with personal data collection off (AC-4, AC-5)", () => {
    const options = sentryOptions({
      dsn: "https://k@o1.ingest.sentry.io/2",
      environment: "production",
      runtime: "browser",
    });
    expect(options.enabled).toBe(true);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.initialScope.tags).toEqual({ runtime: "browser", service: "browser" });
    expect(options.dataCollection.userInfo).toBe(false);
    expect(options.dataCollection.httpBodies).toEqual([]);
    expect(options.dataCollection.cookies).toBe(false);
    expect(options.dataCollection.urlQueryParams).toBe(false);
    expect(options).not.toHaveProperty("integrations");
  });

  it("scrubs in beforeSend", () => {
    const options = sentryOptions({ dsn: "x", environment: "production", runtime: "web" });
    const event = options.beforeSend({ user: { id: "u1", email: "ada@example.com" } });
    expect(event).toEqual({ user: { id: "u1" } });
  });
});

describe("sentryEnvironment", () => {
  it("maps to development, production or preview", () => {
    expect(sentryEnvironment("production", "development")).toBe("development");
    expect(sentryEnvironment("production", "production")).toBe("production");
    expect(sentryEnvironment(undefined, "production")).toBe("preview");
    expect(sentryEnvironment("staging", "production")).toBe("preview");
  });
});

describe("service tag (AC-1 to AC-3)", () => {
  it.each(["web", "browser", "jobs"] as const)(
    "every %s event starts with service: %s",
    (runtime) => {
      const options = sentryOptions({ dsn: "x", environment: "production", runtime });
      expect(options.initialScope.tags.service).toBe(runtime);
    },
  );
});

describe("jobFailureTags", () => {
  it("carries task, run, attempt and allowlisted IDs, never the payload (AC-3)", () => {
    const tags = jobFailureTags({
      task: "trim-take",
      runId: "run_abc",
      attempt: 3,
      payload: { takeId: "take_1", title: "My holiday", r2Key: "takes/x/original.mov" },
    });
    expect(tags).toEqual({
      service: "jobs",
      runtime: "jobs",
      task: "trim-take",
      runId: "run_abc",
      attempt: "3",
      takeId: "take_1",
    });
    expect(JSON.stringify(tags)).not.toMatch(/holiday|original\.mov/);
  });
});

describe("workerSentryOptions", () => {
  const input = {
    dsn: "https://k@o1.ingest.sentry.io/2",
    environment: "production",
    runtime: "web",
  } as const;

  it("turns deduplication off so every route error is sent (S1C-T11)", () => {
    expect(workerSentryOptions(input).enableDedupe).toBe(false);
  });

  it("keeps the shared options", () => {
    expect(workerSentryOptions(input)).toMatchObject({
      enabled: true,
      environment: "production",
      tracesSampleRate: 0,
      initialScope: { tags: { runtime: "web", service: "web" } },
    });
  });
});
