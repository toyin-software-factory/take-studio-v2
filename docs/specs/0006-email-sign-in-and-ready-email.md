# 0006. Email sign in (magic link) and "take ready" email

**Date**: 2026-11-11
**Status**: Accepted

## Summary

Creators can sign in with a one time link sent to their inbox (no password), alongside Google, and get an email when a take finishes processing (ready, or failed with what to do next), with a one click way to turn those emails off. Emails go through Resend from `mail.vowmory.com`, sender "Take Studio <hello@mail.vowmory.com>". This is the follow up promised in spec 0004.

## Context

Slice 1 ships with Google sign in only and in app status only (spec 0004). Some creators don't use Google, and processing takes minutes, so creators often close the tab. Toyin chose Resend and a subdomain of a domain already on Cloudflare (`mail.vowmory.com`).

Verified on official pages (2026-11-11): Resend's free plan sends 3,000 emails a month with a limit of 100 a day and 3 domains; the Pro plan is $20 a month for 50,000 emails with no daily limit. The `resend` SDK returns `{ data, error }` rather than throwing, with a default limit of 10 requests a second. Domain verification needs the DKIM and SPF records Resend generates (TXT and MX), usually verified within 15 minutes; on Cloudflare these records must not be proxied.

## Requirements

**User stories**:
- As a creator without Google, I want to sign in with a link sent to my email.
- As a creator, I want an email when my take is ready, so I don't have to keep the tab open.
- As a creator, I want to stop those emails with one click.

**Acceptance criteria**:
- **AC-1**: The sign in page offers "Continue with Google" and "Email me a sign in link" (email field). Submitting shows "Check your inbox" without revealing whether the email has an account.
- **AC-2**: The link signs the creator in on the same device or another, works once, and expires after 15 minutes; an expired or used link shows a friendly page with a button to send a new one.
- **AC-3**: The same email via Google and via magic link is one account (account linking), never two.
- **AC-4**: Sign in link requests are limited to 3 per email per 15 minutes and 10 per IP per hour (stored in the database, since Workers have no shared memory); over the limit shows a friendly message.
- **AC-5**: When a take's job finishes, its creator gets one email: ready ("Your take '<title>' is ready", link to the take page, removed time or the no pauses note) or failed (the friendly message and the next step). Never more than one email per job; re-renders and retries send again only for their own job.
- **AC-6**: Every take email has a `List-Unsubscribe` header with one click unsubscribe (`List-Unsubscribe-Post`), so the mail app's own unsubscribe button turns emails off in one click, and a "Turn off these emails" link (signed, no sign in needed) that opens a confirm page with one button. Opening the link alone never changes the setting, because mail scanners follow links. The setting can be turned back on from the take page. Sign in link emails are always sent.
- **AC-7**: Emails come from `Take Studio <hello@mail.vowmory.com>`, pass SPF and DKIM, and contain no video, transcript or storage links; only the take title and a link to the app.
- **AC-8**: If Resend fails or the daily limit is hit, sign in shows "We couldn't send the email, please try again or use Google", and take emails are retried by the job (up to 3 times) then dropped with an error reported to Sentry (IDs only); the take itself is unaffected.

## Decision

**Chosen option**: Better Auth's magic link plugin plus Resend for all email, with take emails sent from the Trigger.dev job finish path.

**Implementation skills**: `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`) · `better-auth-security-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-security-best-practices/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`)

## Rationale

Better Auth already runs sign in (spec 0001) and has a magic link plugin, so no new auth system is added; account linking keeps one account per email. Sending take emails from the job (after `jobs.finish`) means the email always matches the final state and retries with the job's own machinery. A per user preference column plus a signed unsubscribe link meets email rules without building a settings page yet.

## Feature design

**Data model** (additive migration): `user.take_emails` boolean, default true. Rate limit rows: Better Auth's database rate limit table (per IP and path) plus a small table of our own for the per email limit (email hash, window start, count), since Better Auth's limiter is per IP and path only; both additive. `processing_job.notified_at` timestamp (null until the email is sent), so a job emails at most once.

**Sign in**: Better Auth `magicLink` plugin with `expiresIn` 15 minutes, `sendMagicLink` calling Resend; `accountLinking` enabled with Google as a trusted provider; rate limit storage `database` with the AC-4 rules on the magic link endpoint. Sign in page per `design.md`: Google button, divider, email field, primary "Email me a sign in link"; states idle, sending, sent, error, rate limited.

**Take emails**: after `jobs.finish` commits (succeeded or failed), the task calls `notifyTakeFinished(jobId)`: skips if `notified_at` is set or the creator turned emails off, renders a plain HTML and text email, sends via Resend with an idempotency key `take-email-{jobId}`, then sets `notified_at`. Unsubscribe link: `/emails/off?u=<userId>&s=<HMAC(userId, EMAIL_LINK_SECRET)>`. A GET only redirects (303) to a confirm page carrying `u` and `s` and never writes; the confirm page's button, and the mail app's one click unsubscribe, POST to `/emails/off`, which checks the signature and sets `take_emails` false. The take page shows a small "Email me when takes are ready" switch.

**Email content**: subject and body follow `design.md` voice; links are absolute to the app's base URL; no images beyond text styling.

**Value sourcing**:
| Value | Source |
|---|---|
| sender | `EMAIL_FROM` setting (`Take Studio <hello@mail.vowmory.com>`) |
| app base URL | `BETTER_AUTH_URL` |
| email recipient | `user.email` (Better Auth) |
| take title, removed time, note | `take`, latest render, job (spec 0004) |
| failure text | the shared take messages (spec 0004) |
| unsubscribe signature | HMAC of user ID with `EMAIL_LINK_SECRET` |

**Security model**: no account enumeration on the sign in form; single use, short lived links; rate limits in the database; signed unsubscribe links that only turn emails off; no secrets or personal content beyond the title in emails; Sentry gets IDs only.

**Configuration required**:
- `RESEND_API_KEY`: Worker secret and Trigger.dev Production env
- `EMAIL_FROM`: sender address
- `EMAIL_LINK_SECRET`: signs unsubscribe links (Worker and Trigger.dev)
- DNS: Resend's DKIM and SPF records for `mail.vowmory.com` in Cloudflare, not proxied; then a DMARC record

**Critical test scenarios**:
- Magic link happy path, expired link, used link, and Google plus email linking to one account, verifies **AC-1**, **AC-2**, **AC-3**.
- Rate limit: a fourth request within 15 minutes is refused, verifies **AC-4**.
- A finished job sends exactly one email even if `notifyTakeFinished` runs twice; turned off emails send none, verifies **AC-5**, **AC-6**.
- Resend failure: sign in shows the friendly error; take email retries then reports to Sentry, verifies **AC-8**.

## Build plan

1. Resend client, `EMAIL_FROM`, email templates (sign in, ready, failed) with tests, satisfies **AC-7**.
2. Magic link sign in: plugin, account linking, database rate limits, sign in page states, expired and used link page, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-8**.
3. Take emails: migration (`take_emails`, `notified_at`), `notifyTakeFinished` from the job finish path with idempotency and retries, unsubscribe link and switch, satisfies **AC-5**, **AC-6**, **AC-8**.

## Consequences

**Positive**: creators without Google can use the product; creators can close the tab and still know when a take is ready.

**Negative / tradeoffs**: Resend's free plan caps at 100 emails a day, which real daily use will pass (upgrade to Pro at $20 a month then); one more account, DNS setup and secrets.

**Neutral**: a full email preferences page can come later; the unsubscribe switch covers the rules for now.

## Follow-up

- [ ] Toyin creates the Resend account, adds `mail.vowmory.com`, adds the DNS records in Cloudflare (not proxied), and adds the keys (exact steps when the build starts).
- [ ] Upgrade Resend to Pro before daily email use passes about 80 a day.
