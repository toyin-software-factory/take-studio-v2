import * as Sentry from "@sentry/nextjs/cloudflare";
import handler from "../.open-next/worker.js";
import { sentryEnvironment, workerSentryOptions } from "./lib/sentry-options";

/**
 * The Worker entry (wrangler.jsonc `main`): OpenNext's handler wrapped with Sentry, so
 * unhandled errors in the Worker reach Sentry with `runtime: web` (spec 0005, AC-1).
 * SENTRY_DSN is a Worker secret; without it Sentry stays off. SENTRY_ENVIRONMENT is set to
 * `production` and SENTRY_RELEASE to the git commit SHA by the deploy command only.
 */
type SentryEnv = {
  readonly SENTRY_DSN?: string;
  readonly SENTRY_ENVIRONMENT?: string;
  readonly SENTRY_RELEASE?: string;
};

export default Sentry.withSentry(
  (env: SentryEnv) =>
    workerSentryOptions({
      dsn: env.SENTRY_DSN,
      environment: sentryEnvironment(env.SENTRY_ENVIRONMENT),
      runtime: "web",
      release: env.SENTRY_RELEASE,
    }),
  handler,
);
