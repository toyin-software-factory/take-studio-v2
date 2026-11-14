# 0016. Product analytics

**Date**: 2026-11-14
**Status**: Proposed

## Summary

Toyin needs a few honest numbers: how many people sign up, how many upload a take, how many download the result, and how many come back for a second take. This spec adds first party, server side events kept in our own database (no vendor, no cookie, no new processor), a private page where only Toyin sees the counts, and a retention rule. Events carry IDs and small codes only, never video, transcript text, titles or emails. Founding member progress (C-26: 50 active free users with 2 or more videos uploaded) is one of the numbers on the page.

## Context

The scope promises "three events that show whether the core loop works: signup, take uploaded, take downloaded, recorded per creator, with no video content or transcript text in the events". Toyin and Michael asked for this to be built early so the growth ideas under Deferred can be measured.

Facts from the code and earlier specs:

- Every step we want to count already happens in a server function: Better Auth creates the `user` row (signup), the upload complete route moves a take out of `uploading` (take uploaded), the process job ends `succeeded` (take ready), the AI edit step records `done` or `unavailable` (spec 0012), a change request starts a job (spec 0011), `GET /api/takes/{id}/media?kind=download` issues the download link (spec 0004), and `limit_exceeded` is answered by the usage code (spec 0014).
- The only cookie is the Better Auth session cookie. Spec 0015 says there is no analytics or advertising cookie and names every processor. Anything that adds a processor, a cookie, a stored field or an event must update `src/lib/legal-facts.ts` and the copy (0015 AC-10).
- Sentry is for errors only and scrubbed (spec 0005). Logs and job payloads carry IDs only.
- `user.created_at` and take timestamps already exist, so the past can be backfilled for signups and uploads.
- Account deletion removes the user row (spec 0002). The monthly usage count is the one thing kept, under a keyed hash (spec 0014).

Forces: no consent banner, so no cookie and no third party that sees visitors; Workers friendly (a plain insert, no SDK); cost near zero at our size; the numbers must be right (no double counting from retries); recording an event must never break the feature it measures; privacy words on the Privacy page must stay true.

## Requirements

**User stories**:
- As Toyin, I want one private page that shows the funnel (signed up, uploaded, ready, downloaded, second take) and how many founding members we have out of 50, so I can decide what to build next.
- As Toyin, I want to see AI edit use, renders (change requests), failures and limit hits, so I know what the product costs and where people get stuck.
- As a creator, I want no tracking cookie and no third party watching me, and I want my events gone when I delete my account.

**Acceptance criteria**:
- **AC-1**: Events are written by the server only, to a new `analytics_event` table in our database. No script, pixel, cookie, local storage key or third party request is added to any page.
- **AC-2**: The event names are a closed list in `src/lib/analytics-events.ts`: `signup`, `take_uploaded`, `take_ready`, `ai_edit_used`, `change_requested`, `take_downloaded`, `transcript_downloaded`, `take_failed`, `limit_hit`. Each name has a strict zod schema for its properties. Properties are only enums, small integers, or booleans (for example the download kind, a failure code, a count of cuts). Strings that come from a person are not allowed by type.
- **AC-3**: Each event row holds the event ID, the name, the creator ID, an optional take ID, the time, and the validated properties. It never holds an email, a name, a title, a file name, a transcript word, a presigned link, an IP address or a user agent. A test fails if a schema allows a free text property or if a property key is on a blocklist (`email`, `name`, `title`, `text`, `transcript`, `url`, `ip`, `file`).
- **AC-4**: `signup` is recorded once per creator when the account is created, `take_uploaded` once per take in `completeUpload`, right after the R2 object is completed and before the probe is dispatched (so it carries the real completion time and still counts a take the probe later rejects), `take_ready` once per take on its first succeeded run (with `props.aiEdit` read from the persisted `ai_edit` step row of that job, never from the step's return value, because a retried run returns `skipped` even when the stored step succeeded: step `succeeded` gives `done`, `skipped` with failure code `ai_unavailable` gives `unavailable`, and any other status, failure code or a missing row gives `none`, the same rule `aiEditState` in `src/server/takes/index.ts` already uses), `ai_edit_used` once per take when the AI edit finishes `done`. These are protected by unique indexes, so a retry, a repeated request or a replayed job never counts twice.
- **AC-5**: `take_downloaded` is recorded when a `download` link is issued (not `play`, `thumb` or `original`) and `transcript_downloaded` when a transcript file is served, each with its kind. Repeats are recorded (they are real use); the funnel counts distinct creators, never takes (a deleted take's events lose their take ID, so a take count would drift).
- **AC-6**: Recording is best effort. A failed insert is logged with the event name and take ID only and never changes the response or fails a job. It runs after the main work has committed, not inside the user's transaction. A dropped insert is repaired, not forgotten: the cleanup sweep compares the once per rules against the real rows (`user` for `signup`, `take` for `take_uploaded`, the succeeded job for `take_ready`, the finished AI edit step for `ai_edit_used`) and inserts what is missing using the same idempotent insert. The time is the row's own time where one exists (`user.created_at`), and for `take_uploaded` it is the probe time derived from `video_expires_at` (the take row holds no completion time), so a repaired upload can be a little late and a take the probe rejected cannot be repaired. Repair can only see rows that still exist, so a take deleted before its repair is not recovered; counts can undercount by that small, logged number.
- **AC-7**: A private page at `/insights` shows counts only, for a chosen window (7 days, 30 days, all time): signed up, uploaded, ready, downloaded, second take (creators with 2 or more `take_uploaded`), AI edit use, change requests, failures by code, limit hits, and founding member progress (creators with 2 or more uploaded takes, out of 50). It shows no per creator rows, no emails and no names.
- **AC-8**: Only the viewer named in config can open `/insights`. Everyone else, signed in or not, gets the same 404 as any missing page. The page is `force-dynamic`, `Cache-Control: private, no-store` and `noindex`, and it is not in the sitemap.
- **AC-9**: Two retention rules, both constants in `src/lib/analytics-events.ts`. Milestone events (`signup`, `take_uploaded`, `take_ready`, `ai_edit_used`) are kept as long as the account exists, because the second take, founding member and all time numbers need them, and they hold only IDs, a time and a code. Repeatable events (`change_requested`, `take_downloaded`, `transcript_downloaded`, `take_failed`, `limit_hit`) are kept 13 months (`ANALYTICS_RETENTION_MONTHS`, not env). The existing cleanup sweep deletes older repeatable rows in batches. A test covers the cutoff and that milestone events are not purged.
- **AC-10**: Deleting an account deletes that creator's events (foreign key `ON DELETE CASCADE`). Deleting a take sets the event's take ID to null and keeps the event. A test deletes both and checks what is left.
- **AC-11**: The Privacy facts stay true by test. `COLLECTED` in `src/lib/legal-facts.ts` gets a "product events" entry that lists the event names, the purpose, the retention and "deleted with your account". A test fails when an event name is not listed there, when `PROCESSORS` gains an analytics entry without a copy change, or when the retention in the copy differs from the constant. The copy date and version are bumped in the same PR that ships the first event.
- **AC-12**: The numbers match the real rows. The repair in AC-6 keeps them in line, and the page says so in one line ("counts come from recorded events and can miss a few"). Tests cover a retry that must not double count, a deleted take, a second take by the same creator, and the founding member rule (2 or more `take_uploaded`, counted once per creator). Backfill from existing rows is idempotent.

## Options considered

### Option 1: First party events in our Postgres, server side (chosen)

A small table, inserts from the places that already know the step happened, and counts by SQL.

- Pros: no new processor, no cookie, no banner, nothing for Toyin to sign up for; the Privacy page stays as it is plus one line; events line up with real rows (a count can be checked against `take`, and the sweep repairs gaps); works on Workers with the database client we already use; free.
- Cons: we build the page and the queries; no session replay, no page view or landing visit numbers; ad blockers are irrelevant but so are visitors who never sign up.

### Option 2: A product analytics vendor (for example PostHog)

A hosted tool with a browser script or an SDK.

- Pros: ready made funnels and retention charts, session tools if wanted.
- Cons: a new processor (registry, copy, and a lawyer check), a cookie or local storage by default (so a consent banner), a script on every page, an SDK on Workers, a cost that grows with events, and a real risk that a title or email leaks into an event by mistake. It also sees visitors before they sign up, which is the most sensitive part.

### Option 3: Both, first party for the numbers and a cookieless visitor counter for the landing page

Option 1 plus Cloudflare Web Analytics (already our host) for landing page visits.

- Pros: adds visit to signup conversion without a cookie.
- Cons: still a registry and copy change, and one more thing to check; useful only once marketing starts (C-24 is parked).

## Decision

**Chosen option**: Option 1: first party, server side events in our own database.

Decisions taken as recommended defaults (Toyin may change any; see Follow up for the numbered questions):

1. Tool: first party events in Postgres, no vendor.
2. Landing visits: not measured now. Revisit with Option 3 when the marketing plan starts.
3. Who sees the numbers: one private page, counts only, for one named viewer.
4. Retention: milestone events for the life of the account, other events 13 months.
5. Account deletion: a creator's events are deleted with the account.
6. Founding member: 2 or more takes uploaded counts as active (matches C-26), shown as a number out of 50.
7. Events: the three in the scope plus six more that answer the questions about readiness, AI use, renders, failures and limits.

**Implementation skills**: `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`) · `workers-best-practices` (`cloudflare/skills`, `.claude/skills/workers-best-practices/`)

## Rationale

The questions Toyin asked are about what people do after they sign in. Every one of those steps is a server side fact, so a table in our own database answers them closely (with a repair step for any dropped write) and needs no browser code. That keeps the Privacy promise simple (no analytics cookie, no new processor) and keeps events away from personal data by construction: the schema cannot hold free text. A vendor adds the one thing we do not need yet, watching anonymous visitors, and costs a banner and a processor entry. If marketing later needs visit counts, Option 3 adds them without changing this table.

## Feature design

**Data model sketch** (Drizzle, migration generated with `pnpm db:generate`):

- `analytics_event`: `id uuid pk default gen_random_uuid()`, `name text not null` (check constraint on the closed list), `creator_id text not null references user(id) on delete cascade`, `take_id uuid null references take(id) on delete set null`, `props jsonb not null default '{}'`, `occurred_at timestamptz not null default now()`.
- Indexes: `(name, occurred_at)` for the windows; `(creator_id, name)` for the second take and founding counts; unique `(creator_id)` where `name = 'signup'`; unique `(take_id, name)` where `name in ('take_uploaded','take_ready','ai_edit_used')` and `take_id is not null`.
- Backfill (one migration step, idempotent with `on conflict do nothing`): `signup` from `user.created_at`; `take_uploaded` from each take that has a `video_expires_at`, using a derived time (explained below). Takes deleted before launch have no row, and the usage table holds seconds only, so no durable record of them exists: historical counts exclude them (a creator who uploaded and deleted a take before launch can be undercounted by one). The take table has no upload completion column, and `updated_at` changes with later activity, so it is not used. The only stored time is `video_expires_at`, which the probe's `markUploaded` sets as the probe time plus `VIDEO_RETENTION_DAYS`. So historical rows carry the probe time (derived as `video_expires_at` minus that many days, using the same constant), which can be later than the real completion time if a probe was delayed, and takes the probe rejected or that were never probed have a null `video_expires_at` and get no historical event; these gaps make the old counts a little low and are accepted. A new event that is written succeeds with the real completion time. If that insert fails, the repair in AC-6 has only the same stored time, so it uses the same derivation and has the same gaps: the repaired event carries the probe time, and a take the probe rejected cannot be repaired. This is accepted and small, because it needs a failed insert and a rejected probe together. The step reads only the take ID, the creator ID and `video_expires_at` from the take row when it is built.

**Files**:
- `src/lib/analytics-events.ts` (pure): `ANALYTICS_EVENTS` (name, zod props schema, once per rule), `ANALYTICS_RETENTION_MONTHS`, `FOUNDING_MEMBER_TARGET` (50) and `FOUNDING_MEMBER_MIN_TAKES` (2).
- `src/db/schema/analytics.ts` and its migration.
- `src/server/analytics/`: `record.ts` (`recordEvent(db, event)` validates with zod and inserts with `on conflict do nothing`, returns the `Result` type, never throws), `report.ts` (`funnel(db, window)` returns the counts), `deps.ts`.
- Call sites, each one line after the work commits: the Better Auth user create hook in `src/server/auth.ts`, upload complete in `src/server/uploads/`, the end of `process-take` and the AI edit step in `src/trigger/`, the changes start in `src/server/changes/`, the media route (download kind) and the transcript download route, the failure path, and `limitExceededResponse` plus the early upload refusal. Job code writes through `src/db` only and does not import `src/server` (ESLint boundary), so the shared insert lives in `src/db/data/analytics.ts` and `src/server/analytics` wraps it.
- `src/app/insights/page.tsx` (default export for the page only) with a small `src/components/insights/` view: one table of counts and the founding progress bar, with a text alternative (WCAG AA).
- The cleanup sweep gains `purgeOldAnalyticsEvents` (batches of 1000, repeatable events only, older than the retention) and `repairAnalyticsEvents` (AC-6).

**Value sourcing** (every number the page shows, and where it comes from):

| Number | Source |
|---|---|
| Signed up | count of `signup` events in the window |
| Uploaded | distinct creators with `take_uploaded` in the window |
| Ready | distinct creators with `take_ready` |
| Downloaded | distinct creators with `take_downloaded` where `props.kind = 'video'` |
| Second take | creators with 2 or more `take_uploaded` events (all time, then the second one's time is in the window) |
| AI edit use | count of `ai_edit_used`; the share is `take_ready` events in the window whose `props.aiEdit` is `done`, over all `take_ready` events in the window (the AI edit outcome rides on the ready event itself, so the cohort is one set of rows, no join, and deleted takes stay in it) |
| Change requests | count of `change_requested` |
| Failures by code | count of `take_failed` grouped by `props.code` |
| Limit hits | count of `limit_hit` |
| Founding members | creators with 2 or more `take_uploaded` events, over `FOUNDING_MEMBER_TARGET` |
| Window | the `window` search param, parsed with zod (`7d`, `30d`, `all`), default `30d` |

**Invariants**:
- An event is written after the thing it describes has committed, and only once for the once per rules.
- No event property comes from user text. The schemas, not reviewers, enforce it.
- The report returns numbers, never rows with identities.

**Security and privacy**:
- Viewer gate: `INSIGHTS_VIEWER_USER_ID` (a user ID, not an email, set as a Worker secret and added to the env schema and the deploy env list). The page compares the session user ID; anything else is a 404. Documented in `src/server/AGENTS.md`.
- The Privacy copy change (AC-11) says: we count product events (signed up, uploaded, downloaded and similar) against your account to learn how the product is used; they hold no video, words, titles or email; kept while your account exists (other events 13 months); deleted with your account; no cookies or third parties for this.
- No cookie, no processor: `PROCESSORS` and the cookie list in the 0015 facts do not change. If a later decision adds a vendor or a visitor counter, it updates the registry and copy first.

**Config**: `INSIGHTS_VIEWER_USER_ID` only (secret, read inside the page's guarded path with `safeParse`; missing means 404, never a 500). Retention and targets are constants in `src/lib`.

**Test scenarios**: each event written once per its rule with a retry and a replayed job; a failed insert does not change a route's answer or a job's result; the schema rejects a free text property and a blocklisted key; the page 404s for a stranger and another signed in creator; the counts for a seeded set (including a creator with two takes and a deleted take); the retention cutoff; account delete removes events; take delete nulls the take ID; the backfill runs twice with the same result; the legal drift test fails when an event name is missing from `COLLECTED`.

## Build plan

Tracer Bullet: one real event through every layer first (table, record, report, page), then the rest.

1. Table, migration, `analytics-events.ts`, `recordEvent`, and the `signup` event with its test, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-6**
2. `funnel` and the `/insights` page with the viewer gate, showing signups only, satisfies **AC-7**, **AC-8**
3. Upload and job events (`take_uploaded`, `take_ready`, `ai_edit_used`, `take_failed`) and the founding member and second take counts, satisfies **AC-4**, **AC-7**, **AC-12**
4. Download, transcript, change request and limit events, satisfies **AC-5**, **AC-4**
5. Backfill from existing users and takes, satisfies **AC-12**
6. Retention and repair in the cleanup sweep, and the delete tests, satisfies **AC-6**, **AC-9**, **AC-10**
7. Legal facts entry, drift test and copy bump (touches the 0015 files, so it lands after 0015's facts file exists), satisfies **AC-11**
8. Docs: `src/server/AGENTS.md`, `src/lib/AGENTS.md` and the deploy env list for the viewer secret

## Consequences

**Positive**:
- Toyin gets the funnel and the founding member count with no cookie, no vendor and no banner.
- Counts line up with real rows and cannot double count.

**Negative / tradeoffs**:
- No landing page visit numbers and no session views until a later decision.
- We maintain a small report and page ourselves.
- An event table grows; the 13 month rule and the indexes keep it small at our size.

**Neutral**:
- Billing (feature 12 onwards) can reuse the table for plan events, each needing a registry and copy entry.

## Follow-up

Open questions for Toyin, sent to Michael as numbered options (recommended first):

- [ ] 1. Tool: (a) Our own events in our database, no vendor (recommended). (b) A vendor such as PostHog (adds a processor, a cookie and a banner). (c) Our own now, a vendor later if we need more.
- [ ] 2. Landing page visits: (a) Not measured for now (recommended, nothing to add to the Privacy page). (b) Add Cloudflare Web Analytics, no cookie, when marketing starts. (c) A vendor tool with a cookie banner.
- [ ] 3. Who sees the numbers: (a) A private page only you can open (recommended). (b) The page plus a weekly email summary to you. (c) Michael and you both. Tell us the account to allow.
- [ ] 4. How long events are kept: (a) Sign up, upload, ready and AI edit events for as long as the account exists, other events 13 months (recommended, the all time and second take numbers need the first group). (b) Everything 13 months, and all time numbers become "last 13 months". (c) Everything 24 months.
- [ ] Known gap for Toyin: takes deleted before launch can't be backfilled, so a founding member count can be low by a few. Accept it (recommended), or tell us a list of creators to count by hand.
- [ ] 5. When someone deletes their account: (a) Delete their events too (recommended, the simplest promise). (b) Keep the events with no link to the person, which keeps old totals but needs one more line on the Privacy page.
- [ ] 6. Founding member means: (a) 2 or more takes uploaded, ever (recommended, matches C-26). (b) 2 or more takes that finished. (c) 2 or more takes and at least one download.
- [ ] 7. Events: (a) The three you asked for plus ready, AI edit, change request, transcript download, failure and limit hit (recommended). (b) The three only.
- [ ] If Toyin picks a vendor or the visitor counter, update the registry and copy in spec 0015's files before any code ships.
- [ ] Later: a weekly email report, cohort views (week one return), and a visit to signup number once marketing starts.

## References

**Project sources** (verifiable, in this repo):
- Specs 0002 (data model, account deletion), 0004 (media links), 0005 (error monitoring scrub), 0011 (changes), 0012 (AI edit), 0014 (usage limit), 0015 (privacy and terms, legal facts and the change checklist)
- `docs/scope/scope.md` row 17 and C-26 (founding members)
- `src/server/auth.ts` (user create hook), `src/server/media/index.ts` (download links), `src/server/takes/http.ts` (limit_exceeded)

**Practices & standards**:
- Data minimisation: record the smallest fact that answers the question, with closed lists instead of free text
- Server side event capture from the system of record, so counts match the data and need no cookie
