import * as Sentry from "@sentry/nextjs";
import { sentryEnvironment, sentryOptions } from "@/lib/sentry-options";

// Server init for `next dev` (Node.js). In the Worker, src/worker.ts creates the client and
// this only passes on the build release (spec 0005).
Sentry.init(
  sentryOptions({
    dsn: process.env.SENTRY_DSN,
    environment: sentryEnvironment(process.env.SENTRY_ENVIRONMENT, process.env.NODE_ENV),
    runtime: "web",
  }),
);
