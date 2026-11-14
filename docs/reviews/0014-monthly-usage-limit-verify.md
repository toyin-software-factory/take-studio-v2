# Verify: monthly usage limit, spec 0014

**Verdict: PASS with one open clause. Every AC is met by the code and mapped to a passing test or a recorded check below, except the email sentence of AC-6, which is not met and is open for the lead to reconcile with the spec (see Notes 1).** Nothing needed fixing beyond tests. Smaller notes (AC-10 and AC-13 evidence) are under "Notes".

Run on 2026-11-14 on branch `b2-t35-verify-usage-limit` (main at `e2ec4ac`), against `next dev` with the local Postgres. Only synthetic accounts and seeded takes (`tests/support/session.ts`, `tests/support/takes.ts`, `tests/support/usage.ts`); no real take or account was used. The browser spec `tests/usage.spec.ts` ran in full on a clean server: 16 of 16 pass (8 desktop, 8 phone, Pixel 7 size). The real pipeline check (`tests/pipeline/usage.ts`) needs R2 and Trigger.dev keys and was not run here; it was run and merged with its step (B2-T11 and the pipeline check task).

## Result per acceptance criterion

| AC | Result | Coverage |
| --- | --- | --- |
| AC-1 what counts | Pass | `jobs.test.ts` (initial charges length, retry after a non refundable failure charges 0, re-render charges 0 and refunds nothing, cancel cases), `src/db/data/usage.test.ts` ("charges 0 on a retry while an earlier charge stands", "keeps usage after the take and the account are deleted") |
| AC-2 allowance setting | Pass | `usage-rules.test.ts` (`parseUsageSettings`, `monthlyAllowanceSeconds`), `usage.test.ts` "reads the seeded defaults shape and a changed value" |
| AC-3 `usage_month` | Pass | `usage.test.ts` (new month on a new row, usage kept after deletion), `usage-hash.test.ts` |
| AC-4 atomic check | Pass | `usage.test.ts` (exact fit, one second over, no row when the first charge is too big, one of two parallel starts wins), `jobs.test.ts` (simultaneous starts, one charge), pipeline check |
| AC-5 refund | Pass | `usage.test.ts` (refund once then retry charges again, returns to the charged month, never below 0, not refundable kept), `jobs.test.ts` (refund once even when finished twice) |
| AC-6 probe ending and message (take page and library) | Pass for the take page and library; **email clause not met (open)** | `src/trigger/probe-limit.test.ts`, `usage-routes.test.ts` (retry says the dated message and charges nothing, expiry before reset), `limitExceededMessage` in `usage-rules.test.ts`, `usage-meter.test.ts` `failedMessage`, `usage.spec.ts` (library and take page, kept and expiring, **new:** expiring take page at both widths) |
| AC-7 early refusal | Pass | `usage-routes.test.ts` "early refusal at upload" (0 left, hint over what is left, exact fit, missing or bad hint) |
| AC-8 `GET /api/usage` | Pass | `usage-routes.test.ts` (needs a session, exactly four numbers, no email or hash, only the caller, private no-store) |
| AC-9 what the creator sees | Pass | `usage-meter.test.ts`, `usage-rules.test.ts` (`usageDisplay`, `usageNotice`), `usage.spec.ts` (meter, 80% notice, used up area, limit off, refused upload reads numbers again) |
| AC-10 account tricks | Pass | `usage.test.ts` "puts a +tag address on the same account", `usage-hash.test.ts` (Gmail variants), deletion keeps usage; `hash_version` stored by `src/db/data/usage.ts` |
| AC-11 backfill | Pass | `usage.test.ts` "backfill and reconcile" (counted once, safe to run twice, refunded jobs never added) |
| AC-12 billing fits | Pass | `usage-rules.test.ts` "is the free number for every account today"; `monthlyAllowanceSeconds(settings, account)` is the only conversion, nothing stores a plan or price |
| AC-13 private and observable | Pass (read in code) | `probe.ts` returns `limit_exceeded` as a typed outcome and logs `logger.info` with IDs only, no error tracker call; `usage-routes.test.ts` checks no email or hash in bodies |
| AC-14 accessible and responsive | Pass | `usage.spec.ts`: axe in every state at both widths; meter is a `progressbar` with name and `aria-valuetext`; the notice is a polite `role="status"`; the disabled upload button stays focusable with its reason as its accessible description; **new:** no sideways scroll and 44 px targets (touch run) |

## Added by this task

`tests/usage.spec.ts`, two tests at both widths (4 runs): "the meter and the used up area fit the screen and keep 44 px targets" and "a take that expires before the reset says to upload it again, on the take page". The library failed message case also checks for no sideways scroll now. All pass.

## Notes

1. **AC-6 email clause: not met, open.** AC-6 says the "failed" email of spec 0006 "says the same in plain words". A take refused at the limit has no job (AC-6 itself) and that email is sent per job, so it never fires on this path; `notify.ts` also passes no expiry or reset date to `failureMessage`, and `notify.test.ts` has no `limit_exceeded` case, so it could not produce the dated wording anyway. The spec itself lists a take based email for `limit_exceeded` as optional later (Follow-up), which contradicts the AC sentence. The result above is recorded against the take page and library only. The lead decides: drop or reword that sentence of AC-6, or build the email (add the expiry and reset dates to the email input and a `notify.test.ts` case).
2. No test asserts the stored `hash_version` value (AC-10); it is the `USAGE_HASH_VERSION` constant at insert. Low risk.
3. Enforcement is still switched off by the `usage_limit_enabled` setting until the one time reconcile is run and Toyin approves the backfill gap (spec open item). Feature 12 is code complete and verified, not yet enforcing.
4. Local runs: `next dev` leaks Postgres connections ("too many clients"); two runs failed for that reason and passed on a clean restart. Not a product issue.
