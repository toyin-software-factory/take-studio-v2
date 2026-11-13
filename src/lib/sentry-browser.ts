import * as Sentry from "@sentry/nextjs";
import { setBrowserReporter } from "./browser-errors";
import { sentryEnvironment, sentryOptions } from "./sentry-options";

/**
 * Starts the Sentry browser SDK (spec 0005, AC-2) and replays errors queued while it loaded.
 * Loaded after the page is idle by `instrumentation-client.ts`, so it is not in the first load.
 * No Replay, no Feedback, no tracing (AC-5). The DSN and environment are inlined at build time;
 * without a DSN nothing is sent (AC-8).
 */
export function startSentryBrowser(): void {
  Sentry.init({
    ...sentryOptions({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: sentryEnvironment(
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        process.env.NODE_ENV,
      ),
      runtime: "browser",
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    }),
    // Errors only: no release health session pings either.
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "BrowserSession"),
  });
  setBrowserReporter((error) => {
    Sentry.captureException(error);
  });
}
