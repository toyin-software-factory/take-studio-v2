# Server layer (src/server)

Creator scoped functions behind the routes in `src/app/api`. Specs: [0002](../../docs/specs/0002-data-model/index.md), [0004](../../docs/specs/0004-core-take-loop/index.md). The data functions underneath, the `Result` type and transactions are in [src/db/AGENTS.md](../db/AGENTS.md).

- Routes are thin: a `route.ts` calls a handler from `src/server/{uploads,takes}/http.ts` and exports `dynamic = "force-dynamic"`. The real dependencies (session, R2, Trigger.dev) come from the sibling `deps.ts`; tests call the handlers with injected deps.
- Each `http.ts` maps error codes to an HTTP status and a friendly message (`STATUS` and `MESSAGES`). Responses carry `cache-control: no-store`.
- Checks run in this order: Origin, then session, then ownership. Origin must equal the origin of `BETTER_AUTH_URL`. It is checked on writes (POST, PATCH, DELETE); GET list, detail and media skip it.
- Ownership lives in the query (`eq(take.creatorId, creatorId)`; cuts and renders join through the take). Media links are presigned only after the ownership check and an R2 HEAD.
- Sessions: pages read the session through `getSession()` in `request.ts`, which also sets the Sentry user to `{ id }`. API routes use `getCreator` in each `deps.ts`, which does not set the Sentry user.
- Retention is 30 days from upload completion and never extended (`VIDEO_RETENTION_DAYS`). The cleanup sweep runs every 15 minutes, so `isExpired` (`src/lib/take-media.ts`) also counts a take past `videoExpiresAt` as expired before the sweep marks it: media links answer 410 and retry answers 409 at once. A `processing` take is not expired until its job ends.
- Upload limit: 10 per creator per hour, counting failed ones (429 `rate_limited`).
- Email (spec 0006): `src/server/email/` holds the sign in limits, the signed turn off link (`/emails/off`: GET only redirects to a confirmation page, POST changes the setting, no session) and the take page switch API (`/api/account/email-prefs`, same guard and Origin check as takes). The sender and templates live in `src/lib/email/` because jobs use them too.
- Transcripts (spec 0007): `src/server/transcripts/` and `GET /api/takes/{id}/transcript` (session, then ownership; another creator's take is 404). `state` is derived per request (transcript row, else the latest `transcribe` job). `getForCreator`'s `latestJob` ignores `transcribe` jobs so the progress view only follows video jobs.
- Multipart upload and R2 rules: [src/server/uploads/AGENTS.md](uploads/AGENTS.md).

_Drafted by /sync from a catch up over the merged work, worth a quick human pass._
