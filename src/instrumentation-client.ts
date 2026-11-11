import * as Sentry from "@sentry/nextjs";
import { sentryEnvironment, sentryOptions } from "@/lib/sentry-options";

// Browser errors (spec 0005, AC-2). No Replay, no Feedback, no tracing (AC-5). The DSN and
// environment are inlined at build time; without a DSN nothing is sent.
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
