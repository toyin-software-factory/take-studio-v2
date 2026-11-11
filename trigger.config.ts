import { defineConfig } from "@trigger.dev/sdk";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { ffmpeg, syncEnvVars } from "@trigger.dev/build/extensions/core";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";

// Sentry (spec 0005): source maps are uploaded on deploy only when CI has a token
// (deploy.yml), then deleted from the image; the deploy also tells the jobs their Sentry
// environment and release (the git commit SHA).
const sentryUpload = process.env.SENTRY_AUTH_TOKEN
  ? [
      esbuildPlugin(
        sentryEsbuildPlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          telemetry: false,
          release: { name: process.env.SENTRY_RELEASE },
          sourcemaps: { filesToDeleteAfterUpload: ["**/*.map"] },
        }),
        { placement: "last", target: "deploy" },
      ),
    ]
  : [];

export default defineConfig({
  // Not a secret (spec 0001): the project ref lives here, not in env or CI.
  project: "proj_myruzrkdrkciyulujiba",
  runtime: "node-22",
  dirs: ["./src/trigger"],
  tsconfig: "./tsconfig.json",
  // Video jobs need room for a 2 GB input plus output on local disk (spec 0001).
  machine: "medium-1x",
  // 30 minutes of compute per run. Long enough for a 10 minute 1080p take.
  maxDuration: 1800,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 2_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [
      ffmpeg({ version: "7" }),
      syncEnvVars(
        ({ environment }) => [
          { name: "SENTRY_ENVIRONMENT", value: environment === "prod" ? "production" : "preview" },
          ...(process.env.SENTRY_RELEASE
            ? [{ name: "SENTRY_RELEASE", value: process.env.SENTRY_RELEASE }]
            : []),
        ],
        { override: true },
      ),
      ...sentryUpload,
    ],
  },
});
