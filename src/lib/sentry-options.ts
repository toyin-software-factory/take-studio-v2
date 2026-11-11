import { jobTagsFrom, scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

/**
 * Shared Sentry options for the Worker, the browser, `next dev` and jobs (spec 0005).
 * Errors only, minimal data collection, every event and breadcrumb scrubbed. With no DSN the
 * SDK is disabled, so local dev, CI and tests send nothing (AC-8).
 */

export type SentryRuntime = "web" | "browser" | "jobs";
export type SentryEnvironment = "production" | "preview" | "development";

/**
 * `development` under `next dev` or Trigger.dev dev; otherwise the deploy says `production`
 * (deploy.yml sets it), and anything else is `preview`.
 */
export function sentryEnvironment(configured?: string, nodeEnv?: string): SentryEnvironment {
  if (nodeEnv === "development") return "development";
  return configured === "production" ? "production" : "preview";
}

/**
 * v11 collects user info, cookies, headers, bodies and query values by default; turn every
 * category off (AC-4). Source context lines are code, not personal data, so they stay.
 */
export function minimalDataCollection() {
  return {
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
}

/** The options every runtime shares. Spread into the runtime's own init. */
export function sentryOptions({
  dsn,
  environment,
  runtime,
  release,
}: {
  readonly dsn: string | undefined;
  readonly environment: SentryEnvironment;
  readonly runtime: SentryRuntime;
  /** The git commit SHA from CI; left out, the SDK uses the release injected at build. */
  readonly release?: string;
}) {
  return {
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    environment,
    ...(release ? { release } : {}),
    // Errors only (AC-5): no tracing, no profiling; replay and feedback are never added.
    tracesSampleRate: 0,
    dataCollection: minimalDataCollection(),
    initialScope: { tags: { runtime } },
    beforeSend: <E extends object>(event: E): E => scrubEvent(event),
    beforeBreadcrumb: <B extends object>(breadcrumb: B): B => scrubBreadcrumb(breadcrumb),
  };
}

/**
 * Tags for a job's final failure (AC-3): runtime, task, run ID, attempt, and only the
 * allowlisted IDs found in the payload. The payload itself is never returned.
 */
export function jobFailureTags({
  task,
  runId,
  attempt,
  payload,
}: {
  readonly task: string;
  readonly runId: string;
  readonly attempt: number;
  readonly payload: unknown;
}): Record<string, string> {
  return {
    runtime: "jobs",
    task,
    runId,
    attempt: String(attempt),
    ...jobTagsFrom(payload),
  };
}
