# Production runbook

What to do when a deploy broke production, when data is wrong, or when something is on fire. Every step goes through CI or a dashboard. Nobody deploys by hand, and no step needs a `.env` file or a secret typed into a terminal. This page names IDs and dashboards only, never values.

Production is four things: the **Worker** (the web app, Cloudflare, name `take-studio`), the **Trigger.dev tasks** (video jobs, prod environment), the **Neon database** and the **R2 bucket**. A deploy changes the first two and may change the third. Know which one is broken before you act.

## First steps in an incident (start here)

1. **Say so.** Tell Michael (lead) in the team channel: what you see, since when, and how many people it touches. Michael tells Toyin in Slack. Toyin speaks only through Michael, and builders never message Toyin directly. Michael decides what Toyin hears and when.
2. **Look before you change anything.**
   - **Sentry** (one project, tag `service`: `web`, `browser` or `jobs`; the `release` tag is the git commit SHA of the deploy, so you can see which deploy an error started with). Alerts email Toyin on a new kind of error and on more than 10 events in an hour. Events carry IDs only, never video, transcript text or links.
   - **Cloudflare, Workers and Pages, `take-studio`, Observability:** request logs and errors of the Worker (observability is on in `wrangler.jsonc`). Also **Deployments** on the same page: which version is live and since when.
   - **Trigger.dev dashboard, Prod environment, Runs:** failed, stuck or queued runs by task (`process-take`, `transcribe-take`, `preview-background`, `cleanup`, `storage-deletion`). **Deployments** shows which task version is live.
   - **GitHub Actions, workflow Deploy:** the last run and which step it stopped at (the order is build and check, migrate, Trigger.dev, R2 lifecycle, ship the Worker).
   - `GET /api/health` on the live site says whether the Worker and its database connection answer.
3. **Find out what changed.** Compare the time the errors began with the last Deploy run and the `release` tag in Sentry. If it began with a deploy, go to section 1. If a migration ran in it, read section 3 too.
4. **Put the app in a safe state if it is hurting people** (a bad job is burning usage, charging, or corrupting takes). There is no maintenance page in the app. The levers are:
   - **Pause processing** in the Trigger.dev dashboard (Prod, Queues): pause the `process-take` queue (and `transcribe-take`, `preview-background` if they are the problem), or pause the whole environment. Uploads still work and the takes wait; nothing is lost, and resuming starts the waiting runs. Say so to Michael, because creators see their takes sit in processing.
   - **Roll back the Worker** (section 1) if the web app is the problem.
   - **Turn off guest uploads** (spec 0023, the homepage drop box for people who are not signed in) if guest drops are the problem (abuse, bot traffic, cost). In the Neon console, production branch, SQL editor, run:
     `INSERT INTO app_setting (key, value) VALUES ('guest_upload_enabled', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = now();`
     It takes effect on the next drop, no deploy. New drops are refused and the drop card asks people to sign in; drops already uploading finish. To turn them back on, run the same line with `'true'`. Signed in creators are not affected. Say so to Michael.
   - Anything beyond this (taking the site down) is Michael's decision with Toyin. If you think you need it, say so; do not improvise.
5. **Fix forward through a PR.** The fix, or the revert, is a normal PR to main. CI deploys it. Nobody deploys by hand.
6. **After it is calm:** write down what happened (time, cause, what was lost) in a short note to Michael, and add the lesson here if this page was wrong or missing a step.

## 1. Roll back the Worker

**Path: the `Roll back the Worker` workflow** (`.github/workflows/rollback.yml`, run from GitHub Actions, Run workflow, branch `main`).

Why this one and not "redeploy an older commit": the Deploy workflow always deploys the commit it was started on, which on `main` is the newest main commit, so an older commit cannot be redeployed from it (and it would rebuild, rerun the migration and ship new Trigger.dev tasks, which is slow and adds risk in an incident). A rollback only switches the Worker to a version Cloudflare already holds, with the bindings that version had. It takes seconds and touches nothing else. Migrations are backward compatible (expand, then contract later), so the older Worker still runs on the newer database.

Guards: it runs only from `main`, only in the `production` environment (the same approval rules as a deploy), has its own concurrency group (so a later Deploy can never cancel a waiting rollback), and works with a **deploy freeze**: the Deploy workflow stops itself at its `order` step while the repository variable `DEPLOY_FREEZE` is `true`, and the rollback refuses to run unless that variable is `true` and no Deploy run is still going. GitHub cannot share one queue between two workflows without one cancelling the other, so the freeze is the shared lock. Unset or empty means Deploy runs as normal, so the variable only needs to exist during an incident. It only needs the Cloudflare secrets CI already holds.

Steps:

1. **Freeze deploys.** In GitHub, Settings, Secrets and variables, Actions, Variables, set `DEPLOY_FREEZE` to `true` (create it if missing). Then open Actions and cancel any CI run for the bad commit that has not finished and any Deploy run that is running or waiting, so nothing starts a deploy in the gap. A Deploy that starts while the variable is `true` stops itself with a notice and ships nothing.
2. Actions, `Roll back the Worker`, Run workflow, branch `main`, **mode `list`**. It prints the live deployment and the recent Worker versions with their IDs and times. Pick the last version from before the bad deploy (a version ID is a UUID, not a secret). Cross check with the commit SHAs in Sentry `release`.
3. Run it again with **mode `rollback`**, the `version_id` from step 2 (required: an empty one would pick a new target after every attempt, so a re-run could undo the rollback; use the same ID on every attempt) and a short `reason` (under 100 characters, no personal data). Approve it if the environment asks.
4. Open the Cloudflare Workers `take-studio` Deployments page, or read the last step of the run, to see the earlier version live. Check `/api/health` and the page that was broken.
5. **Revert the bad commit on main through a PR now.** A rollback does not change the code on `main`. While `DEPLOY_FREEZE` is `true` no merge deploys, so nothing is lost, but nothing new ships either, and that includes the revert's own Deploy: it is skipped too. The revert (a `git revert` PR, titled `[TASK-ID] Revert ...`) goes through CI like any change. Merge it, and write down the revert commit SHA.
6. **Lift the freeze and ship the revert by hand.** If a database restore is part of this incident (section 3), do not do this yet: keep the freeze until the restore is finished and checked. Set `DEPLOY_FREEZE` to `false` (or delete it). The skipped Deploy does not come back by itself, so in Actions open `Deploy`, Run workflow, branch `main` (workflow_dispatch). It deploys the newest commit on `main`, which is the revert, so confirm the revert is the tip first. Approve it if the environment asks.
7. **Check the revert is live.** When that Deploy run ends green, check that the revert commit is the one live: the run's checkout and Sentry `release` use the commit SHA, so the commit check is the green `Deploy` run for the revert SHA: open it, see that its commit is the revert and that its `4. Ship the Worker` step is green. If `SENTRY_DSN` is set (the Deploy preflight only warns when it is not), a new Sentry event (any `service`) also carries `release` equal to the revert SHA. The Cloudflare Workers `take-studio` Deployments page should show a new version made at the time of that run, now at 100%. Check `/api/health` and the page that was broken. Until this passes, the incident is not closed.

**What a Worker rollback does not undo** (check both before you say it is fixed):

- **Database migrations.** The schema stays as the bad deploy left it. If the migration is the problem, go to section 3.
- **Trigger.dev tasks.** The jobs keep running the new task version. If the jobs are the problem, go to section 2. A deploy that changed both the web app and the jobs needs both sections.

If the bad deploy never finished (Deploy stopped at step 1 or 2), production did not change: the Worker is still the old one and nothing needs rolling back. A failure at step 1 stops before any production write. After a failure at step 2 (migrate) read section 3. After step 3 (Trigger.dev) or 4, the earlier steps stay done: rerun the failed Deploy run from the Actions page (the migration and the backfill are safe to repeat) or revert through a PR.

## 2. Trigger.dev: go back to the previous task version

Trigger.dev keeps every deployed version. The Worker rollback does not touch them, so a bad job change needs its own step.

1. **Freeze deploys first**, as in section 1, step 1: set `DEPLOY_FREEZE` to `true` and cancel any CI run for the bad commit and any Deploy run that is running or waiting. Otherwise an unfinished Deploy can publish the bad task version again right after you promote the good one. Keep the freeze on until the revert is ready (step 5).
2. Trigger.dev dashboard, Prod environment, **Deployments**. The current version is marked; the list shows each version with its time and commit.
3. Open the last good version and **promote** it (the Promote action on the deployment). New runs use that version at once. A run already in progress finishes on the version it started on.
4. Pause the affected queue first if bad runs keep starting (section "First steps", step 4), promote, then resume.
5. Failed runs are not retried by themselves, and **do not replay a failed `process-take` or `transcribe-take` run**: its job is already marked failed, so the replay finds a final job and returns `skipped`, and nothing is recovered. The supported way is a new job: once the good version is live, the creator opens the take and presses **Try again** (a failed take shows it when `retryable`; a failed transcript shows Try again too). That makes a new job on the good version. Michael tells the affected creators. `process-take` refunded usage once on failure, so a new job charges once again.
6. **Revert on main.** Promoting a version is a dashboard change. The next Deploy deploys the task code on `main` again, bad or not, and while the freeze is on it ships nothing, so open the revert PR as in section 1, step 5, then lift the freeze and ship it by hand as in section 1, steps 6 and 7. **If this incident also needs a database restore (section 3), keep the freeze on** until the restore is finished and checked and the migration history matches the code on `main` (see section 3); only then lift it.

The jobs read the database and R2 directly, so a job version that wrote bad rows also needs section 3.

## 3. Database (Neon)

Migrations only go forward (`drizzle/`, applied by Deploy step 2 with `pnpm db:migrate`). Never edit, delete or reorder a migration file that has run, and never run `--url` or a hand `drizzle-kit` against production. The migration runs before the Worker ships and is built to be backward compatible, so the old Worker keeps working on the new schema.

**A migration fails while Deploy runs.** The run stops at step 2. The Worker and the jobs are untouched (still the old versions), so production keeps working. Read the error in the run log (names only, no values), fix the migration in a PR, merge. Drizzle applies the pending migrations in one transaction, so a failure normally leaves nothing half done, but check the table and journal state in the Neon console before you merge the fix.

**A migration ran and is bad** (wrong change, slow lock, data it should not have changed). Choose by what is wrong:

- **Fix forward with a new migration (the default).** Write a new migration that corrects the schema or data (`pnpm db:generate`, or a hand written SQL file in the same folder), review it, merge. Deploy applies it. Nothing is lost. Use this whenever the data is still there and only the shape or a value is wrong. Prefer the expand then contract pattern, so a fix never needs the old and new code to agree on a column.
- **Before any restore, roll back the code to match the schema you will restore.** Roll back the Worker (section 1, mode `rollback`) to a version from before the bad migration, and promote the last good Trigger.dev task version (section 2). Keep `DEPLOY_FREEZE` set to `true` until the restore is finished and checked and the migration history is reconciled: a restore rewinds Drizzle's migration journal along with the data, so the next Deploy would apply the bad migration again unless `main` no longer carries it (revert or replace it in a merged PR first). Lifting the freeze comes last, in section 1, steps 6 and 7. A restore removes columns that live code may still use, so the code must match the restored schema first.
- **Neon point in time restore (only when data was destroyed or corrupted and cannot be rebuilt by a migration).** In the Neon console, project, Branches, `production`, **Restore** to a timestamp just before the bad migration. Restore to a **new branch first**, not over production: check the data on the branch, and only then restore production to that time. Neon keeps the pre restore state as a separate backup branch, named `{branch_name}_old_{head_timestamp}`, so a mistaken restore can be undone from that branch. The backup branch is not removed when the restore history window ends; it stays until someone deletes it, so do not delete it until the incident is closed. The history window (how far back a restore can reach) depends on the Neon plan: read it in the console (Settings, restore window) and write the number into this page the first time you look.

**What a restore loses.** Everything written after the restore time, in all tables, with no automatic way to merge it back (the backup branch below still holds those rows until someone deletes it, so someone can copy the ones that matter by hand): new sign ups and sessions, uploads and takes created after that moment, finished jobs and renders, usage counts (a creator's minutes used rewind, so they may get free minutes back), API keys created after the point (the raw key is gone for good, the creator makes a new one), analytics events. Rows that point to R2 objects stay consistent only when the objects still exist: a take deleted after the restore time comes back as a row whose video R2 has already deleted (section 4), and files uploaded after the restore time stay in R2 with no row (the 35 day backstop removes them). Tell Michael exactly what time window is lost, and Michael tells Toyin, before restoring production.

After a restore: the connection strings stay the same when you restore in place. If you used a new branch as the new production, the new connection details have to be set in Hyperdrive (Cloudflare), Trigger.dev Prod `DATABASE_URL` and the GitHub `DATABASE_URL_DIRECT` secret, which is a change for Michael to approve. Prefer in place restore.

Also pause the Trigger.dev queues (section "First steps", step 4) before any restore. Pausing stops new runs from starting but does not stop a run already in progress, so then wait for the active runs to finish or cancel them in the Trigger.dev dashboard, and check none is left running before you restore. Resume the queues after the restore is checked, so no job writes to a half restored database.

## 4. R2 (files)

Bucket prefixes: `originals/{takeId}/`, `renders/{takeId}/`, `previews/` and `backgrounds/`. Transcripts live in the database, not in R2. The app deletes a take's files with the deletion queue (`storage-deletion`) and the `cleanup` task (every 15 minutes), 30 days after upload (`VIDEO_RETENTION_DAYS`).

The bucket's own **lifecycle rules** (`src/lib/storage-lifecycle.ts`, applied by Deploy step 3b with `R2_LIFECYCLE_TOKEN`) are a backstop for anything the app leaves behind:

- Delete objects under `originals/`, `renders/` and `previews/` **35 days** after they were written (`BACKSTOP_DAYS`, always longer than the 30 day promise).
- Abort multipart uploads that were never completed after **2 days**.
- Never touch `backgrounds/`.

**What cannot be recovered.** There is no R2 backup and no object versioning in this repo, so a deleted object is gone for good: a creator's video past 30 days, a take a creator deleted, a file deleted by a bad cleanup run, anything under the three prefixes older than 35 days. A database restore does not bring files back. Do not change the lifecycle rules or the sweep without Michael: a shorter number deletes real videos for good. If a bad deploy changed deletion code, **pause the `cleanup` schedule and the `storage-deletion` queue in Trigger.dev at once** (Prod, Schedules and Queues) and tell Michael: that is the one case where minutes matter, because every deleted file is permanent.

The built in studios under `backgrounds/builtin/` are rebuilt by the `cleanup` task if they go missing. Uploaded backgrounds are not.

## Who to tell and where things live

| What | Where |
| --- | --- |
| Tell first | Michael (lead). Michael tells Toyin in Slack. |
| Errors | Sentry (tags `service`, `release`) |
| Worker logs and versions | Cloudflare, Workers and Pages, `take-studio` |
| Jobs, queues, task versions | Trigger.dev dashboard, Prod environment |
| Database, restore | Neon console, project branch `production` |
| Files, lifecycle | Cloudflare R2 bucket (name is the `R2_BUCKET` secret) |
| Deploys and the rollback | GitHub Actions, workflows `Deploy` and `Roll back the Worker` |

This page does not cover a leaked secret or a breach. Rotate the secret in its dashboard (Worker secret, Trigger.dev Prod env var, GitHub secret) and tell Michael at once; the list of where each key lives is in [spec 0001](specs/0001-stack-architecture/index.md).

## Keeping this page true

Update it in the PR that changes any of: the deploy order, a queue or schedule name, the retention or lifecycle numbers, the hosting or database provider. The workflow `rollback.yml` is the only rollback path; do not add a second one by hand.
