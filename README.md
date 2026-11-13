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
pnpm dev                   # next dev + trigger dev (needs a Trigger.dev login)
pnpm dev:web               # next dev only
```

`db:migrate` (and any `pnpm db:*` script that connects, since they all load `drizzle.config.ts`) refuses a database that isn't on localhost unless it runs in CI or you set `MIGRATE_TARGET=prod`. Credentials passed straight to drizzle-kit with `--url` skip that config and the guard. With `DATABASE_URL_DIRECT` unset it uses local Postgres (`postgres://postgres:postgres@localhost:5432/take_studio`). Agent sandboxes carry no database URL; production migrations run only from CI.

`pnpm install` also sets up a git pre commit hook (`simple-git-hooks` plus `lint-staged`, config in `.lintstagedrc.json`). On each commit it runs ESLint and Prettier on your staged files only: Prettier fixes the formatting for you, and an ESLint error stops the commit until you fix it. It takes about two seconds. Typecheck and tests are not in the hook; run them before you push, and CI runs them too. The hook is not installed when `CI` is set. To skip it once, use `git commit --no-verify`. If you change the hook command in `package.json`, run `pnpm exec simple-git-hooks` to reinstall it. If you already have your own `pre-commit` hook, install keeps it and prints a warning instead of overwriting it; to use this one, add `pnpm exec lint-staged` to your hook.

With `core.hooksPath` set globally, git runs hooks only from that global folder, never from this repo's `.git/hooks`, so this hook won't run. The safest fix keeps your global hooks: in your global `pre-commit`, call `pnpm exec lint-staged` when you are inside this repo. Pointing this repo at its own folder instead (`git config --local core.hooksPath .git/hooks`, then `pnpm install`) also works, but then your global hooks (`commit-msg`, `pre-push` and others) stop running here unless you copy or link them into `.git/hooks`.

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

## Pipeline check (before a release)

`pnpm test:pipeline` runs the whole take loop end to end through the real API and tasks: create an upload, PUT the parts straight to R2, complete, probe, process, then read the take and its media links. It runs this for every fixture in `tests/fixtures/media`:

- a normal MP4 with a pause;
- a portrait MOV with `moov` at the end;
- HDR;
- an A/V sync clip;
- a clip with no pauses;
- a silent clip;
- an 11 minute file;
- a 4K file.

It checks final states and messages, cuts and margins, `removedMs`, charges and refunds, render size, colour, CFR and faststart, and A/V sync at every cut (at most one frame). It also checks media link lifetimes and file names, "Try again", the limits, and that a second creator gets 404 on every route. It ends by deleting everything it made, through the real deletion path. It prints one line per check and exits non zero if any fails.

**When:** run it before releasing anything that touches uploads, the probe, `process-take`, the take routes or the data model. It isn't part of PR CI, because it needs real R2 and Trigger.dev access and takes a few minutes.

**What it needs:**

- local Postgres (`pnpm db:up`);
- ffmpeg 7 on your machine;
- `BETTER_AUTH_SECRET`, the `R2_*` variables, `TRIGGER_DEV_SECRET_KEY` (a `tr_dev_` key) and `TRIGGER_ACCESS_TOKEN` in your environment.

It starts `next dev` on port 3100 and `trigger dev` itself, against your local database, and uses a throwaway usage secret. Your app data is untouched. Test files go to the R2 bucket under random take IDs and are deleted at the end.

```bash
pnpm db:up
DATABASE_URL_DIRECT=postgres://postgres:postgres@localhost:5432/take_studio pnpm db:migrate
pnpm test:pipeline
```

On a small machine (3 GB) add `PIPELINE_START=prod`: it builds the app once and runs `next start` instead of `next dev`, which the kernel kills at about 1 GB (for example `PIPELINE_ONLY=changes PIPELINE_START=prod pnpm test:pipeline`).

The migrate line gives the pipeline's default local database (`take_studio`) its tables, whatever `DATABASE_URL_DIRECT` your shell has. If you override `PIPELINE_DATABASE_URL`, point `DATABASE_URL_DIRECT` at that same database.

## CI and deploy

- **CI** (`.github/workflows/ci.yml`, every PR): install, lint, format check, typecheck, Vitest, a check that `drizzle-kit generate` makes no new migration, Worker build, then Playwright against the built Worker with Postgres as a service container.
- **Deploy** (`.github/workflows/deploy.yml`, push to main, one at a time): migrate Neon, deploy Trigger.dev tasks, deploy the Worker. Migrations must be backward compatible.

Secrets and where each one lives: spec 0001, "Where each key lives".
