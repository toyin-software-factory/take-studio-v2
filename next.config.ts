import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Root AGENTS.md is owned by /audit, so `next dev` must not write one.
  agentRules: false,
  // No image optimisation service on Workers (spec 0001, Runtime rules).
  images: { unoptimized: true },
};

// Source maps are only made and uploaded when CI has a Sentry token (deploy.yml); the browser
// maps are then deleted before OpenNext copies the assets, so none are served (spec 0005,
// AC-6). Without a token (local builds, CI tests) nothing is generated or uploaded.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  sourcemaps: { disable: !uploadSourceMaps, deleteSourcemapsAfterUpload: true },
  // The git commit SHA from CI; the SDK reads it in the Worker, browser and `next dev`.
  release: { name: process.env.SENTRY_RELEASE, create: uploadSourceMaps },
  // Errors only (AC-5), and the Worker must stay small (AC-8): no build time tracing
  // instrumentation, no route manifest, tracing and debug code tree shaken out.
  buildTimeInstrumentation: false,
  routeManifestInjection: false,
  bundleSizeOptimizations: { excludeTracing: true, excludeDebugStatements: true },
});

// Gives `next dev` the Worker bindings (Hyperdrive) from wrangler.jsonc.
void initOpenNextCloudflareForDev();
