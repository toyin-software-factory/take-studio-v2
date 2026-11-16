# B2-T186 verify: Terms change notice email

Date: 2026-11-16. Branch `b2-t186-terms-notice-email`. Nothing was run against production.

## What was checked

| Check | Result |
| --- | --- |
| Dry run against the local database (`DRY_RUN` unset, so it defaults to true) | Printed `33 recipients of 43 accounts (10 skipped)` and `dry run, nothing sent`. A count only, no address, no id. |
| Dry run without the send secrets | Fails early with `Missing secrets: <names>` (names only, never a value), so a green dry run means the real send can start. |
| Unknown notice id | Stops with the list of known ids, exit code 1. |
| Send through a mocked sender to one synthetic test address | `{ recipients: 1, sent: 1, failed: [] }`, key `terms-2026-11-credit-test-1`. The email text has the sentence, the date and the link to `/terms`. |
| Unit tests (`scripts/send-terms-notice.test.ts`, synthetic data only) | Recipient selection (guests and empty addresses skipped, take email opt out ignored), the key, the email, send with retry on a rate limit, a hard failure kept by user id, no address in the log. |
| Legal facts | The Resend line in `PROCESSORS` did not cover this email, so its role now names the notice. The Privacy copy hash has a new line (`LEGAL_VERSION` was already today). `pnpm legal:drift` flags nothing. |
| Workflow | `.github/workflows/terms-notice.yml` is manual only, uses the `production` environment, and `dry_run` is a boolean that defaults to true. |
| typecheck, check:lines, single file eslint | Clean. |

## Needs a deployed check

- The workflow appearing in the Actions list with `dry_run` ticked (only GitHub shows this, after merge).
- A real Resend send and the `production` approval. Michael asks Toyin to approve the real run.
- Resend keeps an idempotency key for about 24 hours, so a rerun more than a day later can double send. The runbook says to rerun the same day.
