# /check verify: Upload first, sign in after (spec 0023), B2-T176, 2026-11-16

**Verdict: PASS for everything that runs without production keys, with three items handed on.** Nothing here is a silent gap: each item names the task that owns it.

**Ran via**: `bash tests/support/build-worker.sh` (the real Worker, Turnstile test keys baked in), then `TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm exec playwright test tests/guest-claim.spec.ts tests/guest-drop.api.spec.ts tests/home-drop.spec.ts --project=chromium` against the preview on 127.0.0.1:8787 with the local Postgres: **14 passed**. Then `pnpm exec vitest run src/server/guest src/lib/guest-drop.test.ts src/db/data`: **261 passed**. `pnpm legal:drift`: nothing flagged. `pnpm typecheck` and `pnpm check:lines`: clean.

**A real bug found and fixed here.** `/claim` for a stranger or an unknown link showed "Something went wrong". The server page called `buttonVariants` from a `use client` module, which throws on the server. Unit tests and the build did not catch it. `src/app/claim/page.tsx` now uses `<Button asChild>`. The new e2e (AC-5) covers it.

## Per acceptance criterion

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 | met | `home-drop.spec.ts` (card, keyboard, upload client with stubbed Turnstile and storage); `guest-drop.api.spec.ts` shows the route checks origin and Turnstile on the real Worker |
| AC-2 | met in code, send needs a deployed check | `src/server/guest/email.test.ts` and the card's email step in `home-drop.spec.ts`; a real Resend send needs the production key |
| AC-3 | met | `guest-claim.spec.ts` "same browser" lands on `/takes/<id>` and the take row now belongs to the account; signed out goes to sign in and back |
| AC-4 | met, parked part by unit test | "other device" shows the confirm screen (axe clean), the click moves the take; the parked and polling case needs R2 `headObject`, so `claim.test.ts` and `claim-race.test.ts` own it |
| AC-5 | met | stranger and unknown id both show "We couldn't find an upload to add." (axe clean) and the take stays with the guest |
| AC-6 | met | e2e: 501 MB gives 422 `too_large`, foreign origin 403; unit `guest-limits.test.ts`: `guest_busy`, 4th drop `guest_address_limit` (the e2e cannot start a multipart upload on the CI fake R2) |
| AC-7 | met | e2e kill switch gives 503 `guest_paused`; unit tests cover job start and the ready email rule |
| AC-8 | met | e2e `guest_daily_minutes = 0` gives `guest_budget_spent`; `claim-usage.test.ts` covers the charge timing |
| AC-9 | met by unit test | `guest-expiry.test.ts` (sweep deletes file, rows, email, guest); the sweep is a Trigger.dev job, so the scheduled run needs a deployed check |
| AC-10 | met except the result view | e2e: a guest cookie gets no `/library` and no `/api/takes/<id>`; the view only result route and player are **owned by B2-T182 (route) and B2-T183 (player and e2e)** |
| AC-11 | waiting on #383 (B2-T175) | `pnpm legal:drift` is clean on this branch; the legal facts and copy land with #383 |
| AC-12 | waiting on #383 (B2-T175) | the four analytics events land with #383 |
| AC-13 | met | `home-drop.spec.ts` keyboard path and axe; claim screens axe clean |

## Specced surfaces

Built: `guest_claim`, `guest_ip_day`, `guest_budget_day`, `take.guest_origin`, `user.guest`, `POST /api/guest/uploads`, `POST /api/guest/email`, `POST /api/guest/claim`, `/claim`, the sweep, the homepage card. Not yet built, owned elsewhere: `GET /api/guest/take` and the player (B2-T182, B2-T183).

## Needs a deployed check

Real Resend email, real multipart upload to R2, the scheduled sweep, the live Turnstile widget.

## Scope and spec

Scope row 21 and the spec status are updated by /sync once #383 and B2-T183 land; this PR only records the verify.
