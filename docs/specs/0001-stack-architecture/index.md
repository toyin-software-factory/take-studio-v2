# 0001. Stack and architecture for Take Studio

**Date**: 2026-11-10
**Status**: Proposed

## Summary

Take Studio is one TypeScript repo: a Next.js web app running on Cloudflare Workers, plus background video jobs running on Trigger.dev, sharing one Postgres database (Neon) and one file store (Cloudflare R2). Heavy work (ffmpeg trimming, green screen swap, rendering, transcripts with Deepgram, AI editing calls with Claude) never runs in the web app; the web app only signs people in, hands out upload links, starts jobs and shows results. This keeps the web app light and cheap, and puts the slow, heavy work where long runs, retries and progress come built in. The scaffold task builds the empty skeleton of exactly this, with CI and a production deploy.

## Requirements

This is a decision spec (it records the stack), so it has no feature acceptance criteria of its own. The scaffold sub task of scope feature 1 is done when every item in `## Scaffold checklist` below holds. `/check verify` checks that list.

## Decision

**Chosen option**: Option 1: Next.js on Cloudflare Workers, Trigger.dev workers, Neon, R2 (see `rationale.md` for all four options).

One TypeScript monolith repo with two deployables (the web app on Cloudflare Workers and the job worker on Trigger.dev) sharing one Drizzle schema, one Neon Postgres database and one R2 bucket.

**Implementation skills** (Toyin approved; installed by the scaffold task into `.claude/skills/` after confirming each is published by the vendor, drop any that is not): `triggerdotdev/skills` · `better-auth/skills` · `neondatabase/agent-skills` · `cloudflare/skills` · `vercel-labs/agent-skills` · `microsoft/playwright` (playwright-cli). `deepgram/skills` is added in slice 2. No official skill exists for Drizzle, Hyperdrive or Vitest; none third party.

## Rationale

Reasoning and options: see `rationale.md`.

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Architecture | Monolith repo, two deployables: web app and job worker | A small team ships faster with one repo; video work must live outside the web runtime because Workers cannot run ffmpeg on 2 GB files. |
| Language | TypeScript, strict mode; Node 22 LTS (`.nvmrc`, `engines`) | One language across web, jobs and agents; team standard (no `any`, no `@ts-ignore` without a comment). |
| Validation | zod for every request body, env and external input | Team standard; one schema library everywhere. |
| Framework | Next.js (App Router), pinned to the newest version the OpenNext Cloudflare adapter supports | Pages, server actions and route handlers in one app; good SEO for the landing page; hosts the public API and MCP endpoint later. |
| Hosting (web) | Cloudflare Workers (paid plan) via `@opennextjs/cloudflare`; `nodejs_compat` flag and a pinned `compatibility_date` in `wrangler.jsonc` | Toyin's pick; cheap at scale and beside R2. The paid plan (about $5 a month) is needed because the free plan's 10 ms CPU limit is too tight for Next.js rendering and sign in. |
| Primary DB | Neon Postgres. Web app reaches it through Cloudflare Hyperdrive; jobs use Neon's pooled (`-pooler`) URL; migrations use the direct URL | Relational data; scale to zero; branches for safe migrations. Free plan: 1 GB, 100 compute hours a month, 10 branches. |
| ORM and migrations | Drizzle ORM + drizzle-kit, driver `postgres` (postgres.js) everywhere; migration files committed in `drizzle/` | One driver for web and jobs; works through Hyperdrive. Plain SQL for reporting queries. Not the Neon serverless driver through Hyperdrive. |
| Auth | Better Auth (Drizzle adapter, users in Neon). Scaffold: Google sign in only. Email magic link arrives with slice 1 (core take loop), which picks the email sender | No per user fees, all data in one place, the same accounts back API keys and MCP later. |
| File storage | Cloudflare R2, one private bucket, no public domain. Web app presigns with the S3 API via `aws4fetch`; jobs read and write over the S3 API (no binding outside Workers) | Files never pass through the web app; free downloads; small library on Workers. |
| Background jobs | Trigger.dev v4 tasks in `src/trigger/`, ffmpeg via the official `ffmpeg({ version: "7" })` build extension; `machine` at least `medium-1x` with enough disk for a 2 GB input plus output; explicit `maxDuration` and retry policy in `trigger.config.ts` | Long runs, retries and progress built in, per second billing. |
| Video processing | ffmpeg 7 inside Trigger.dev tasks: `silencedetect` for pauses (slice 1 rules), chroma key + overlay for the green screen, one final render | Proven and free; AI matting can replace chroma key later. |
| Speech to text | Deepgram Nova-3 pre recorded, `filler_words=true`, word level start/end times (from slice 2) | $0.0043 a minute; word timings drive SRT captions aligned to the trimmed video and give the agents filler words. We build SRT from word timings. |
| AI editing agents | `@anthropic-ai/sdk`, model `claude-opus-5-5` held in one config constant, structured outputs per decision, the SDK tool runner where a step needs several turns (from slice 5) | Best judgment on which pauses to cut. Cost per take is estimated, to be measured in the slice 5 spec. Not Managed Agents or the Claude Agent SDK: no sandbox needed. |
| Agent access (slice 7) | Public REST API in Next.js route handlers + MCP server on `@modelcontextprotocol/server` (streamable HTTP) at `/mcp` | One interface for programs and AI assistants, same permissions and limits as the web app. |
| Package manager | pnpm, pinned via `packageManager` (corepack) | Fast, strict about dependencies. |
| Lint and format | ESLint flat config via the ESLint CLI (Next.js rules) + Prettier | Standard for Next.js; `next lint` is not used. |
| Tests | Vitest (unit), Playwright (browser smoke and `/check verify`) | Fast unit tests; Playwright drives the real app. |
| CI and deploy | GitHub Actions: CI on every PR; deploy on push to main | Every PR checked the same way; one ordered deploy path. |
| Observability | Decided in the spec for scope feature 6 (error monitoring) | One decision per spec. |

## Runtime rules (the build must honor these)

- **Starting jobs and showing progress:** the web app starts a job with `tasks.trigger` from `@trigger.dev/sdk` in a server action or route handler and returns at once; it never waits on a run. Jobs write their state and step progress to the database (the data model spec defines the tables); the app reads progress from the database by polling. The run ID is stored on our side.
- **Database clients:** two factories in `src/db/client`: a Hyperdrive client for the web app, created per request (never a module level global, Workers forbid sharing I/O across requests), and a direct pooled client for jobs, opened and closed inside each task with a small connection limit and a retry on the first connect (Neon wakes from scale to zero in about a second). Better Auth uses the per request web client. No IP allow list on Neon (Trigger.dev has no fixed IPs); credentials only.
- **Code boundary:** code in `src/trigger/` imports only from `src/db`, `src/lib` and `src/trigger`, never from `src/app` or `src/server`. Code under `src/app` and `src/server` never imports `src/trigger` task internals or heavy SDKs (Anthropic, ffmpeg helpers). Both are enforced with ESLint `no-restricted-imports`. A path alias that both bundlers resolve is used for shared code. This keeps the Worker bundle under Cloudflare's size limit.
- **Storage keys:** objects live under fixed prefixes, `originals/{takeId}/…` and `renders/{takeId}/…` (backgrounds under `backgrounds/{creatorId}/…`). The database stores keys, never URLs. Links are presigned only after an ownership check. Transcripts live in the database, not in R2. Jobs stream files to local disk, never into memory.
- **Privacy:** logs, error reports, and Trigger.dev payloads and outputs carry IDs only (for example `takeId`), never video content, transcript text, presigned links or secrets.
- **Env:** one zod validated env module split into web env and job env; the build must pass with dummy values. `.env.example` lists every variable.
- **Caching:** no ISR or `revalidate` in this app, so OpenNext needs no incremental cache binding. Images use `unoptimized` (no image optimisation service).

## Where each key lives (names only; values go in the platform dashboards and HQ App variables)

| Variable | Cloudflare Worker (secret or var) | Trigger.dev env | GitHub Actions secret | Local `.env` |
|---|---|---|---|---|
| Hyperdrive binding `HYPERDRIVE` (`wrangler.jsonc`, with `localConnectionString` for dev) | yes | | | |
| `DATABASE_URL` (Neon pooled) | | yes | | yes |
| `DATABASE_URL_DIRECT` (Neon direct, migrations) | | | yes | yes |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | yes | | | yes |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | | | yes |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | yes | yes | | yes |
| `TRIGGER_SECRET_KEY` | yes | | | yes |
| `TRIGGER_ACCESS_TOKEN` (deploys) | | | yes | |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | | | yes | |
| `DEEPGRAM_API_KEY` (slice 2) | | yes | | yes |
| `ANTHROPIC_API_KEY` (slice 5) | | yes | | yes |

`TRIGGER_PROJECT_REF` is not a secret; it lives in `trigger.config.ts`.

## CI, deploy and local dev

- **CI (every PR):** `pnpm install --frozen-lockfile`, lint, `tsc --noEmit`, Vitest, a check that `drizzle-kit generate` produces no uncommitted migration, `opennextjs-cloudflare build`, then a Playwright smoke test against the built app. Postgres runs as a service container in CI. The pnpm store and Playwright browsers are cached. Main is protected and these checks are required.
- **Deploy (push to main, one at a time via a concurrency group):** 1) `drizzle-kit migrate` against Neon with the direct URL, 2) `trigger.dev deploy` to the prod environment, 3) `opennextjs-cloudflare build && deploy` for the Worker. Migrations must be backward compatible (expand, then contract later), because old and new code run side by side during a deploy.
- **Environments:** production plus local dev. The app runs on its `*.workers.dev` URL until a custom domain exists. Per PR previews (Workers, Neon branches, Trigger.dev preview branches) come later.
- **Local dev:** one `pnpm dev` runs `next dev` (with `initOpenNextCloudflareForDev()` for the R2 and Hyperdrive bindings) and `trigger.dev dev` together. Postgres 17 runs from `docker compose`. `pnpm preview` runs `opennextjs-cloudflare preview` as a pre deploy check. Trigger.dev dev needs a Trigger.dev cloud project.
- **Scripts the repo exposes:** `dev`, `build`, `preview`, `lint`, `typecheck`, `test`, `test:e2e`, `db:generate`, `db:migrate`, `deploy`.

## Scaffold checklist

The scaffold sub task is done when all of these hold:

1. The repo layout matches: `src/app/` (routes), `src/server/` (server only logic), `src/lib/` (shared helpers), `src/db/` (Drizzle schema and the two client factories), `src/trigger/` (tasks), `drizzle/` (migrations), `tests/` (Playwright), plus `wrangler.jsonc`, `open-next.config.ts`, `trigger.config.ts`, `drizzle.config.ts`, `docker-compose.yml`, `.env.example`, `.nvmrc`.
2. A plain landing placeholder page renders (no features, no design work).
3. `/api/health` on the deployed Worker returns 200 with the database checked through Hyperdrive and the R2 bucket reachable.
4. A hello Trigger.dev task imports the shared Drizzle schema, runs `ffmpeg -version`, and one run succeeds in the prod environment.
5. Google sign in works through Better Auth (sign in and sign out round trip), with Better Auth's tables generated by its CLI and committed.
6. The only schema is Better Auth's tables plus one migration; no product tables (the data model spec, scope feature 3, owns those).
7. One Vitest unit test and one Playwright smoke test pass in CI.
8. CI is green on the scaffold PR; the deploy workflow has deployed to the `*.workers.dev` URL.
9. The approved vendor skills are installed (each confirmed official) or listed as dropped in the PR.
10. The ESLint import boundary rule fails a deliberate wrong import (shown in the PR).

## Consequences

**Positive**:
- The web app stays tiny and cheap; slow video work cannot time out a page.
- One language, one driver and one schema shared by web and jobs.
- Low running cost: free downloads, per second job billing, cents per take for transcripts and AI.

**Negative / tradeoffs**:
- Several vendors to set up and pay (Cloudflare, Neon, Trigger.dev, later Deepgram and Anthropic): more accounts and keys than an all in one platform.
- Next.js on Workers via OpenNext is younger than Vercel's hosting; versions must be pinned and the scaffold must prove build and deploy before features start.
- Two deploy targets must stay in step; this forces backward compatible migrations.
- Hyperdrive pools connections and may keep Neon awake longer, using free plan compute hours faster; watch usage and move to Neon's pay as you go plan if needed.
- ffmpeg chroma key needs evenly lit green screens; poor lighting gives green edges.

**Neutral**:
- Deepgram does not output SRT itself; we build SRT from word timings.
- Trigger.dev tasks reach Neon directly, not through Hyperdrive.

## Follow-up

- [ ] Toyin creates accounts and adds keys before the scaffold can deploy: Cloudflare (Workers paid plan, R2 bucket, Hyperdrive config), Neon project, Trigger.dev project, Google OAuth client (redirect URIs for localhost and the `*.workers.dev` URL), GitHub Actions secrets. Deepgram and Anthropic keys only from slices 2 and 5; set spending caps on both accounts from day one.
- [ ] Slice 1 spec (core take loop) decides: email sender for magic links; multipart upload part size (16 or 32 MiB), retries and ETag handling; R2 CORS config kept in the repo; short link expiry (minutes for uploads, about an hour for downloads); server side checks of size, length and resolution in the job; failed job handling (`onFailure` writes failed, a scheduled cleanup for stuck runs, idempotent retries).
- [ ] Feature 11 spec decides the 30 day deletion details (R2 lifecycle rules on `originals/` and `renders/` in versioned config, nightly reconcile, abort incomplete multipart uploads).
- [ ] Later: custom domain, per PR previews, Dependabot or Renovate.
- [ ] `/audit` (greenfield) records these conventions and the installed skills in root `AGENTS.md` right after the scaffold merges.
- [ ] MCP servers (Neon, Cloudflare, Trigger.dev) connected once Toyin's accounts exist; each builder adds them in their own MCP settings. Playwright MCP optional (agent-browser covers it).
