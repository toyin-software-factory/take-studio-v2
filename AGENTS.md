# Take Studio

## Stack

- **Language / Runtime**: TypeScript (strict), Node 22 LTS
- **Framework**: Next.js (App Router) on Cloudflare Workers via `@opennextjs/cloudflare`
- **Key dependencies**: Drizzle ORM + postgres.js (Neon via Hyperdrive), Better Auth, Trigger.dev v4 (ffmpeg jobs), Cloudflare R2 via `aws4fetch`, zod; later Deepgram (slice 2) and `@anthropic-ai/sdk` with `claude-opus-5-5` (slice 5)
- **Package manager**: pnpm
- Full decision, runtime rules and where each key lives: [spec 0001](docs/specs/0001-stack-architecture/index.md)

## Build approach

**Tracer Bullet**: prove one real thread through every layer first, then thicken one segment at a time, each end to end.

## Commands

```bash
pnpm install                  # install
pnpm db:up && pnpm db:migrate # local Postgres (Docker) + migrations
pnpm dev                      # next dev + trigger dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # run before every push
pnpm test:e2e                 # Playwright smoke tests
pnpm db:generate              # new migration after a schema change (commit it)
```

Production deploys run only from CI on merge to main (build and check the Worker, then migrate, then Trigger.dev, then ship the Worker). Never deploy by hand with `.env*` files present.

Deploy the Worker only through `scripts/deploy-worker.sh`, never `wrangler deploy <file>` (it drops the bindings). The Sentry source map chain and the OpenNext patch are in [scripts/AGENTS.md](scripts/AGENTS.md).

The `pnpm db:*` scripts (via `drizzle.config.ts`) refuse to connect to any non localhost database outside CI unless `MIGRATE_TARGET=prod` is set (`scripts/db-guard.ts`); passing `--url` straight to drizzle-kit skips the guard, so don't; sandboxes carry the production `DATABASE_URL_DIRECT`, so for local work prefix `DATABASE_URL_DIRECT=postgres://postgres:postgres@localhost:5432/take_studio`.

`pnpm test:pipeline` (the API level end to end check, needs R2 and Trigger.dev keys, see README) can leave `next dev` and `trigger dev` running after a failed run, and the local Postgres then answers "too many clients". Stop the leftovers (`pgrep -f 'next[ ]dev'` and `pgrep -f 'trigger[.]dev/dist/esm/index[.]js dev'`, then kill) and run `docker compose restart postgres` before trying again.

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title.md` or `docs/specs/NNNN-title/index.md`. Scope lives in `docs/scope/scope.md`.

## Rules

- **Functional style**: pure functions by default, immutable data (`const`, `readonly`), no shared mutable state, no classes where a function works. Side effects (database, R2, Trigger.dev, Deepgram, Claude, fetch) live at the edges.
- **TypeScript strict**: no `any`; no `@ts-ignore` or `@ts-expect-error` without a comment saying why.
- **zod everywhere input crosses a boundary**: request bodies, forms, env, search params, webhooks, and responses from external services.
- **Errors**: expected failures return a typed result (`{ ok: true, data } | { ok: false, error }`) instead of throwing across boundaries. Creators see friendly messages; logs, error reports and job payloads carry IDs only, never video, transcripts, presigned links or secrets.
- **Folders by feature inside the layers**: `src/app` (routes), `src/server/<feature>/`, `src/trigger/<feature>/`, `src/lib`, `src/db`. Job code never imports `src/app` or `src/server`; web code never imports job internals or heavy SDKs (ESLint enforces it).
- **Small units**: one job per function or component; split a component past about 150 lines.
- **Named exports only**, except where Next.js requires a default export (`page`, `layout`, `route`, `loading`, `error`, `not-found`).
- **Accessibility, WCAG AA**: semantic HTML, full keyboard use, visible focus, AA contrast, alt text, captions for video.
- **Tooling**: ESLint (flat config) + Prettier, Vitest (unit), Playwright (browser); CI runs lint, typecheck, test, build and e2e on every PR. A pre commit hook formats and lints only the staged files (fast); typecheck and tests stay in CI and the before push rule.
- **Git**: one task = one branch = one PR titled `[TASK-ID] …`; the lead merges (squash). Tests where they matter: risky logic, data writes, regressions, shared code.

## Agent skills

Spec 0001 chose OpenNext: where a Cloudflare skill suggests vinext, OpenNext wins.

- [better-auth-best-practices](.claude/skills/better-auth-best-practices/): `better-auth/skills`, Better Auth setup, adapters, sessions
- [better-auth-security-best-practices](.claude/skills/better-auth-security-best-practices/): `better-auth/skills`, rate limits, secrets, CSRF, trusted origins
- [create-auth](.claude/skills/create-auth/): `better-auth/skills`, adding auth flows and providers
- [neon-postgres](.claude/skills/neon-postgres/): `neondatabase/agent-skills`, pooled vs direct, migrations, branching
- [cloudflare](.claude/skills/cloudflare/), [workers-best-practices](.claude/skills/workers-best-practices/), [workers-development](.claude/skills/workers-development/), [wrangler](.claude/skills/wrangler/), [nextjs-on-cloudflare](.claude/skills/nextjs-on-cloudflare/): `cloudflare/skills`, Workers, R2, Hyperdrive, local dev and deploy
- [trigger-setup](.claude/skills/trigger-setup/), [trigger-tasks](.claude/skills/trigger-tasks/): `triggerdotdev/skills`, task code, retries, queues, config
- [vercel-react-best-practices](.claude/skills/vercel-react-best-practices/), [vercel-composition-patterns](.claude/skills/vercel-composition-patterns/), [web-design-guidelines](.claude/skills/web-design-guidelines/): `vercel-labs/agent-skills`, React and Next.js performance, composition, UI review
- [playwright-cli](.claude/skills/playwright-cli/): `microsoft/playwright-cli`, browser tests

MCP servers: Neon, Cloudflare, Trigger.dev (recommended, not connected yet)

## Context files

<!-- Nested AGENTS.md files are listed here as they are created -->

- [src/app/AGENTS.md](src/app/AGENTS.md): routes and pages: force dynamic, signed in and out rendering, error pages, titles
- [src/lib/AGENTS.md](src/lib/AGENTS.md): shared rules: what is pure, add only registries, units, usage hash
- [src/trigger/AGENTS.md](src/trigger/AGENTS.md): jobs: what each task owns, ffmpeg pin, retries, failure codes, import boundary
- [src/db/AGENTS.md](src/db/AGENTS.md): data layer: Result, transitions, transactions, clients, test database, migrations
- [src/server/AGENTS.md](src/server/AGENTS.md): creator scoped functions, route pattern, Origin and ownership checks, sessions, retention
- [src/server/uploads/AGENTS.md](src/server/uploads/AGENTS.md): multipart upload and R2 rules
- [src/components/AGENTS.md](src/components/AGENTS.md): tokens, focus, 44 px targets, Stage, the /design gallery
- [src/components/takes/AGENTS.md](src/components/takes/AGENTS.md): library and take pages, the upload client's browser side, polling and display rules
- [tests/AGENTS.md](tests/AGENTS.md): which command runs which tests and what each needs
- [scripts/AGENTS.md](scripts/AGENTS.md): deploy, Sentry source maps, the OpenNext patch, helper scripts

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
