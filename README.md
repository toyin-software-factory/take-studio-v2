# Take Studio

Upload a video take and get it back with the pauses trimmed, the green screen swapped for a studio background, and a transcript.

What we build: [`docs/scope/scope.md`](docs/scope/scope.md). How it is built: [`docs/specs/0001-stack-architecture/index.md`](docs/specs/0001-stack-architecture/index.md).

## Stack

One TypeScript repo, two deployables, one database, one bucket:

- **Web app**: Next.js (App Router) on Cloudflare Workers via `@opennextjs/cloudflare`. Reaches Neon through Hyperdrive.
- **Jobs**: Trigger.dev v4 tasks in `src/trigger/`, with ffmpeg 7. Reach Neon over the pooled URL.
- **Database**: Neon Postgres, Drizzle ORM with postgres.js, migrations in `drizzle/`.
- **Auth**: Better Auth (Google sign in for now).
- **Files**: Cloudflare R2 over the S3 API (`aws4fetch`).

## Layout

| Path           | What lives there                                           |
| -------------- | ---------------------------------------------------------- |
| `src/app/`     | Routes (pages and route handlers)                          |
| `src/server/`  | Server only web logic (auth, health, per request clients)  |
| `src/lib/`     | Shared helpers (env, R2)                                   |
| `src/db/`      | Drizzle schema and the two client factories (`web`, `job`) |
| `src/trigger/` | Trigger.dev tasks                                          |
| `drizzle/`     | Committed migrations                                       |
| `tests/`       | Playwright smoke tests                                     |

ESLint enforces the boundaries: `src/trigger` imports only `src/db`, `src/lib` and `src/trigger`; `src/app` and `src/server` never import task code or heavy SDKs.

## Local dev

You need Node 22 (`.nvmrc`), pnpm (`corepack enable`), and Docker.

```sh
pnpm install
cp .env.example .env       # then fill in the values
pnpm db:up                 # Postgres 17 in Docker
pnpm db:migrate
pnpm dev                   # next dev + trigger dev (needs TRIGGER_PROJECT_REF and a Trigger.dev login)
pnpm dev:web               # next dev only
```

`pnpm preview` builds the Worker and serves it with workerd on http://localhost:8787, the same runtime as production. Run it before a deploy.

OpenNext bundles `.env` into the Worker at build time, so create `.env` before `pnpm build:worker` or `pnpm preview`.

**Never build the production Worker with local env files present.** Values baked in from `.env*` act as a fallback for any Worker secret or var that is missing, so a missing `BETTER_AUTH_URL` would silently become `http://localhost:3000` and break sign in. Production deploys run from CI on a clean checkout (`deploy.yml` never writes `.env`). `pnpm run deploy` refuses to run while any `.env*` (other than `.env.example`) or `.dev.vars*` file exists.

## Scripts

| Script                                        | What it does                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `dev`, `dev:web`                              | Local dev server (with or without `trigger dev`)                                         |
| `build`, `build:worker`                       | `next build`, or the full OpenNext Worker build                                          |
| `preview`                                     | Build and serve the Worker locally                                                       |
| `lint`, `format`, `format:check`, `typecheck` | ESLint, Prettier, `tsc --noEmit`                                                         |
| `test`, `test:e2e`                            | Vitest unit tests, Playwright smoke tests (run `build:worker` first)                     |
| `db:up`, `db:generate`, `db:migrate`          | Local Postgres, generate a migration, apply migrations                                   |
| `auth:generate`                               | Regenerate Better Auth's Drizzle tables after changing its config or plugins             |
| `deploy`                                      | Build and deploy the Worker (run as `pnpm run deploy`: `pnpm deploy` is a pnpm built in) |
| `deploy:trigger`                              | Deploy the Trigger.dev tasks                                                             |

## CI and deploy

- **CI** (`.github/workflows/ci.yml`, every PR): install, lint, format check, typecheck, Vitest, a check that `drizzle-kit generate` makes no new migration, Worker build, then Playwright against the built Worker with Postgres as a service container.
- **Deploy** (`.github/workflows/deploy.yml`, push to main, one at a time): migrate Neon, deploy Trigger.dev tasks, deploy the Worker. Migrations must be backward compatible.

Secrets and where each one lives: spec 0001, "Where each key lives".
