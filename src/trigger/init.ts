import * as Sentry from "@sentry/node";
import { tasks } from "@trigger.dev/sdk";
import { jobFailureTags, sentryEnvironment, sentryOptions } from "@/lib/sentry-options";

/**
 * Trigger.dev loads this before every task (spec 0005, build plan step 3). Errors only, no
 * default integrations (no HTTP, console or local variable capture). Without SENTRY_DSN in the
 * Trigger.dev environment Sentry stays off.
 */
Sentry.init({
  ...sentryOptions({
    dsn: process.env.SENTRY_DSN,
    // SENTRY_ENVIRONMENT and SENTRY_RELEASE are set by the deploy (trigger.config.ts).
    environment: sentryEnvironment(process.env.SENTRY_ENVIRONMENT, process.env.NODE_ENV),
    release: process.env.SENTRY_RELEASE,
    runtime: "jobs",
  }),
  defaultIntegrations: false,
});

/**
 * A task's final failure, after its retries (AC-3): task name, run ID, attempt and the
 * allowlisted IDs only. The payload is never attached.
 */
tasks.onFailure(async ({ task, ctx, payload, error }) => {
  Sentry.captureException(error, {
    tags: jobFailureTags({ task, runId: ctx.run.id, attempt: ctx.attempt.number, payload }),
  });
  // Tasks can end right after this hook; send before the process is frozen.
  await Sentry.flush(2000);
});
