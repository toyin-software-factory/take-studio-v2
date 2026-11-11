# 0005. Error monitoring

**Date**: 2026-11-11
**Status**: In Progress

## Summary

Errors from the web app (server and browser) and from the Trigger.dev video jobs go to one Sentry project, so the team sees what broke with readable stack traces. Toyin gets an email the first time a new kind of error appears and a daily summary when anything failed that day. Only errors are sent (no performance tracing, no session replay), and nothing personal leaves the app: no request bodies, cookies, emails, file names, transcript text or storage links, only IDs.

## Context

Slice 1 puts real creators' videos through a multi step pipeline across two runtimes (Cloudflare Workers and Trigger.dev). Failures will happen (odd media, provider hiccups, bugs), and today they would only be visible in two separate log consoles nobody watches. The product handles personal data (videos of people, transcripts), and the team rule says logs and error reports carry IDs only.

Decided with Toyin: Sentry; email Toyin on a new kind of error plus a daily summary; the team uses Sentry when fixing.

Verified on official pages (2026-11-11): the free Developer plan has 5,000 errors, 30 day lookback, email alerts, and one user; `@sentry/nextjs` supports Next.js on Cloudflare Workers via OpenNext by wrapping the OpenNext handler with `withSentry`; Trigger.dev documents Sentry via `@sentry/node` in an init file plus `tasks.onFailure`, with `@sentry/esbuild-plugin` for source maps.

## Requirements

**User stories**:
- As Toyin, I want to know when something new breaks, without being flooded.
- As a builder, I want readable stack traces and the IDs I need to reproduce a failure.
- As a creator, I want my videos, transcripts and email never to reach a third party through error reports.

**Acceptance criteria**:
- **AC-1**: An unhandled error in a route handler, server component or the Worker reaches Sentry with environment (`production`, `preview`, `development`), release (git commit SHA) and a `runtime: web` tag.
- **AC-2**: An unhandled error in the browser reaches Sentry with the same release and a `runtime: browser` tag.
- **AC-3**: A Trigger.dev task's final failure reaches Sentry with `runtime: jobs`, the task name, run ID, attempt, and only these IDs as tags: `takeId`, `jobId`, `renderId` when present. The task payload is never attached.
- **AC-4**: No personal or secret data is sent or stored: the Sentry project has "Prevent Storing of IP Addresses" on (Sentry otherwise stores IP and location server side); the SDK's default personal data collection is off (`sendDefaultPii: false` in SDK v10, every `dataCollection` category off in v11); the user is set to `{ id }` only; request bodies, cookies, `authorization` headers and query strings are removed; any URL containing `X-Amz-` or `r2.cloudflarestorage.com` is redacted in events and breadcrumbs; take titles, file names, emails and transcript text are never added. Proven by unit tests on the scrubbing functions.
- **AC-5**: Errors only: tracing sample rate 0, no session replay, no user feedback widget, no profiling.
- **AC-6**: Source maps for the web app and the jobs are uploaded during the CI deploy, so production stack traces show original file names and lines; source maps are not served publicly. For the Worker, the deploy builds the final wrangler bundle, injects debug IDs and uploads that bundle's map, then deploys that exact file with all bindings from `wrangler.jsonc`; a failed upload stops the deploy before production changes. Server frames resolve to `src/`: Next writes server source maps, the maps survive OpenNext's standalone copy, the OpenNext Cloudflare bundle step emits its map (a pinned, gated patch), and the composed map is realigned for the lines the Sentry plugin injects; all of this is on only for deploys that have the Sentry token.
- **AC-7**: Alert rules exist in Sentry: email Toyin when an issue is first seen; email when an issue gets more than 10 events in 1 hour (spike); Sentry's weekly report stays on. (Sentry has no daily digest alert, so the spike alert replaces the daily summary.) The Worker runs with the SDK's Dedupe integration off, so repeated identical errors each send an event and the spike alert can count them.
- **AC-8**: Without `SENTRY_DSN` the app and jobs run and build normally with Sentry disabled (local dev, CI tests); the Worker bundle stays within Cloudflare's limit.

## Options considered

### Option 1: Sentry for web and jobs, errors only (chosen)
**Pros**: one dashboard, grouping, email alerts, official support for both runtimes, free at our volume. **Cons**: one more vendor and account; the free plan has one user.

### Option 2: Cloudflare Workers logs plus Trigger.dev run dashboard
**Pros**: no new account. **Cons**: two places, no grouping or alerts on new errors, browser errors invisible.

### Option 3: Better Stack or Axiom
**Pros**: searchable logs too. **Cons**: more setup, no stronger error grouping than Sentry for our needs.

## Decision

**Chosen option**: Option 1: Sentry, one project, errors only, scrubbed in the SDK.

**Implementation skills**: `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `workers-best-practices` (`cloudflare/skills`, `.claude/skills/workers-best-practices/`)

## Rationale

One project with a `runtime` tag keeps everything in the free plan and one view. Scrubbing in the SDK (`beforeSend`, `beforeBreadcrumb`) means personal data never leaves our environment; Sentry's server side scrubbing is a backup, not the plan. Errors only keeps us far under 5,000 events and avoids Workers' tracing limitation (CPU time shows as 0 ms). The one user limit fits: Toyin owns the account and alerts; builders read issues through the Sentry API with a token when fixing.

## Feature design

**Web (Next.js on Workers)**:
- `@sentry/nextjs`; a custom Worker entry wraps the OpenNext `handler` with `Sentry.withSentry(env => options, handler)`, re-exports what OpenNext exports, and `wrangler.jsonc` `main` points to it.
- `instrumentation.ts` exports `onRequestError`; `sentry.server.config.ts` stays for `next dev`; `app/global-error.tsx` captures client render errors.
- `instrumentation-client.ts`: browser init with no Replay, no Feedback, `tracesSampleRate: 0`.
- `next.config` wrapped with `withSentryConfig` for source map upload in CI only; source maps deleted from the deployed output after upload.

**Jobs (Trigger.dev)**:
- `@sentry/node` initialised in `src/trigger/init.ts` with `defaultIntegrations: false` and default personal data collection off.
- `tasks.onFailure` captures the error with tags from an allowlist (task, run ID, attempt, `takeId`, `jobId`, `renderId`); the payload object is never passed.
- `@sentry/esbuild-plugin` via `esbuildPlugin(..., { placement: "last", target: "deploy" })` uploads source maps on deploy.

**Shared scrubbing** (`src/lib/sentry-scrub.ts`, pure functions, unit tested): strips request data, cookies, headers, query strings; redacts presigned and R2 URLs anywhere in the event and breadcrumbs; drops `user` fields other than `id`; drops `extra` keys not in an allowlist.

**Value sourcing**:
| Value | Source |
|---|---|
| DSN | `SENTRY_DSN` (Worker secret, Trigger.dev env; browser gets it at build time as `NEXT_PUBLIC_SENTRY_DSN`) |
| release | Git commit SHA from CI (`GITHUB_SHA`) |
| environment | `production` on main deploys, `preview` for preview branches, `development` locally |
| user id | Better Auth session user ID (server) |
| job tags | task context and IDs already in task payloads |

**Security model**: SDK side scrubbing as above; Sentry server side data scrubbing on (backup); the auth token lives only in CI and Trigger.dev deploy env; the DSN is not a secret but stays out of the repo.

**Configuration required**:
- `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`: project DSN (Worker secret and build env; Trigger.dev env)
- `SENTRY_AUTH_TOKEN`: source map upload (GitHub Actions secret; Trigger.dev deploy env)
- `SENTRY_ORG`, `SENTRY_PROJECT`: names for upload (GitHub Actions variables)

**Critical test scenarios**:
- A route that throws in production reaches Sentry with release and `runtime: web`, verifies **AC-1**.
- A task that throws reaches Sentry with only allowlisted tags and no payload, verifies **AC-3**, **AC-4**.
- Scrubber unit tests: a presigned URL, a cookie, an email and a request body are all removed, verifies **AC-4**.
- Build and tests pass with no DSN set, verifies **AC-8**.

## Build plan

1. Scrubbing module with unit tests, satisfies **AC-4**.
2. Web: `@sentry/nextjs`, custom Worker entry wrapping OpenNext, `instrumentation.ts`, client init, `global-error`, CI source map upload and removal, satisfies **AC-1**, **AC-2**, **AC-5**, **AC-6**, **AC-8**.
3. Jobs: `init.ts`, `onFailure` capture with allowlisted tags, esbuild plugin for source maps, satisfies **AC-3**, **AC-5**, **AC-6**.
4. Alert rules created through the Sentry API (or documented steps for Toyin), and a one time production check with a deliberate test error from web and jobs, satisfies **AC-7**, **AC-1**, **AC-3**.

## Consequences

**Positive**: failures are visible within minutes, grouped, with readable traces and IDs to reproduce.

**Negative / tradeoffs**: one more vendor and account; only Toyin can log in on the free plan; the custom Worker entry adds a small amount of OpenNext glue to maintain; a little bundle weight in the Worker.

**Neutral**: if volume grows past 5,000 errors a month, Sentry drops extra events until the plan changes.

## Follow-up

- [ ] Toyin creates the Sentry account, organisation and a Next.js project, and adds `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` where the builder says (exact steps when the build starts).
- [ ] The builder doing this needs sandbox access to sentry.io and the Sentry ingest host.
