# Verify: credit go live runbook (B2-T181), 2026-11-16

**Verdict: PASS for the runbook and the SQL. The go live itself is not run by this task.**

This task changes docs only (the runbook and spec 0026). No code, no migration. The migration that seeds the two settings (`credit_enabled` false, `credit_starts_at` null) shipped in B2-T178.

| Check | Result |
|---|---|
| Go live SQL step 2 sets the date once and says `UPDATE 1` | Pass, run on the local database inside a transaction that was rolled back |
| A second run of step 2 changes nothing (`UPDATE 0`), so a set date cannot be overwritten | Pass, same run |
| Step 1 rejects a day that does not exist (`2026-11-31`) and accepts a real one | Pass, run on the local database |
| Step 3 sets `credit_enabled` to `true`, and the check query shows `true` and the date | Pass, same run |
| The kill switch line sets `credit_enabled` false and never clears `credit_starts_at` | Pass by reading, same table and shape as the guest upload line next to it |
| The date format is read by `parseCreditSettings` | Pass, ISO string as JSON, as `credit-rules` expects |

## Needs a deployed check

- Everything that touches production: Toyin gives the go and runs the SQL after B2-T186 (the Terms notice email) is sent. Nothing in this PR runs against production.
- A new synthetic free take showing the credit, made after the start time (the runbook's step 4).
