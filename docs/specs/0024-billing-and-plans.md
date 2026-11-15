# 0024. Billing and plans

**Date**: 2026-11-15
**Status**: Proposed

## Summary

Take Studio stays free for 60 processed minutes a month (spec 0014). This spec adds one paid plan on top, **Creator**, bought through a merchant of record (a company that sells to the customer in its own name and handles sales tax and VAT worldwide). The plan raises the monthly allowance. The first 50 "founding members" (C-26) keep a locked lower price for as long as they stay subscribed. Everything that changes a plan comes from a verified provider webhook; the usage limit code only reads the result.

It is written now so Toyin can review the decisions, and it is built in month 2 (from mid December, C-26). **No real payment account, key or price is created by this spec.** Everything is built and tested in the provider's sandbox with synthetic data.

## Context

Forces and facts from the code and earlier specs:

- Spec 0014 built the whole usage limit and left the seam for this feature: `monthlyAllowanceSeconds(settings, account)` in `src/lib/usage-rules.ts` is the one place that turns settings into a number (0014 AC-2, AC-12). `startJob` charges in one transaction against `usage_month` (keyed by an HMAC of the canonical email, which survives account deletion). Billing changes that function, not the flow.
- Public API keys and the MCP server act as the key's owner, so they get the plan's allowance with no extra work (specs 0018, 0019).
- Toyin chose (C-30) worldwide sales, minimum age 16, a notice under sign in rather than a checkbox, and "founding members get the same free allowance" until billing exists. C-26: 50 active free founding members (2 or more uploaded videos) in months 1 and 2, billing built in month 2, then we ask them to pay.
- Founding members are already counted: `FOUNDING_MEMBER_TARGET` (50) and `FOUNDING_MEMBER_MIN_TAKES` (2) in `src/lib/analytics-events.ts`, and `foundingMembers` in `src/server/analytics/`.
- The stack is Cloudflare Workers (no Node only SDKs, `fetch` and Web Crypto only), Neon Postgres, Resend for email (spec 0006), zod at every boundary, and a rule that any new service, secret, stored personal field or payment step updates `src/lib/legal-facts.ts`, the Privacy and Terms copy and `LEGAL_VERSION` in the same PR (spec 0015).
- The only cookie is the sign in cookie. We want to keep it that way: no third party script on our pages.
- Cost to serve (the numbers the price rests on; **estimates, not measured on real creators**):
  - Speech to text: Deepgram Nova-3 at $0.0043 a minute (spec 0001).
  - AI edit: spec 0012 expected $0.10 to $0.30 for a 10 minute take, which is $0.01 to $0.03 a minute. An older estimate (creative director research, 2026-11-13) said about $0.05 a minute. The real numbers come from Toyin's `ai-eval` and `ai-measure` runs (C-29) and are still owed.
  - Probe, trim and render on Trigger.dev `medium-1x` at $0.000085 a second (published price, checked 2026-11-15, plus $0.000025 a run). Render time per video minute has not been measured in one place; assumed 60 to 180 machine seconds per minute of video, so $0.005 to $0.015 a minute.
  - R2 storage is a few tenths of a cent a take for the 30 days kept; downloads are free.
  - Total: about **$0.02 a minute low, $0.04 middle, $0.07 high** (the high case uses the older AI estimate). Re renders, background changes and cut changes cost something too but are not counted in minutes (0014 AC-1); this is why the margin should not be thin.
- Merchant of record fees checked 2026-11-15 (sources disagree a little; confirm on the vendor page before signing): Paddle 5% + $0.50 a transaction; Lemon Squeezy 5% + $0.50, plus 1.5% on international sales, and its future is tied to Stripe's own Managed Payments; Polar often listed at 4% + $0.40 (one source says 5% + $0.50 now); Stripe Managed Payments about 3.5% on top of Stripe's normal fee (6%+ all in) and subscriptions add Billing's 0.7%; plain Stripe is cheaper (2.9% + $0.30) but then we own sales tax and VAT in every country we sell to.

## Requirements

**User stories**:
- As a creator who hit the free limit, I want to buy more minutes in a minute or two, and be told clearly what I pay and when it renews.
- As a creator, I want to cancel, change card or see my receipts without writing to anyone.
- As a founding member, I want my early support rewarded with a price that does not go up.
- As Toyin, I want taxes, refunds and card handling to be someone else's legal job, and one number I can change to change what a plan includes.
- As the team, I want a failed payment to be handled calmly: a grace period, one email, never a deleted take.

**Acceptance criteria**:

- **AC-1**: Plans are a code registry, not a table: `PLANS` in `src/lib/plan-rules.ts` has `free` (allowance from the `free_monthly_seconds` setting, 0014) and `creator` (`CREATOR_MONTHLY_SECONDS`, default 10800 = 180 minutes). It also lists the four price keys (`creator_monthly`, `creator_yearly`, `creator_founding_monthly`, `creator_founding_yearly`) with the provider price ID read from configuration, never typed in code. The money amounts live only at the provider and in the display copy; code never computes an amount.
- **AC-2**: `effectivePlan(subscription, now)` is pure and is the only place that decides which plan an account is on. `active` → creator. `past_due` and `now < graceUntil` → creator. `canceled` but `now < currentPeriodEnd` → creator (paid time is honoured). An immediate end (refund, chargeback) is stored as `canceled` with `current_period_end` set to the event time and `grace_until` cleared, so this same rule gives free at once; a test covers each. Anything else, or no subscription → free. `monthlyAllowanceSeconds` calls it, so `startJob`, `POST /api/uploads`, `GET /api/usage`, the API and the MCP server all agree. The free allowance setting is unchanged.
- **AC-3**: Allowance in the month. The plan's full monthly allowance applies from the moment the subscription becomes effective, in the current UTC usage month (no proration: seconds already used count against it). When the plan ends, the free allowance applies again; if the month's usage is already above it, new takes are refused with the 0014 `limit_exceeded` message until the 1st (nothing is deleted, nothing is refunded in minutes). Usage months stay UTC calendar months; the billing period is the provider's and is shown separately (decided: simpler than aligning them, see Options).
- **AC-4**: The plan is read inside the `startJob` transaction with one indexed read of `subscription` by user ID, so a plan change and a charge cannot interleave wrongly. The atomic charge statement, the refund and the account hash stay exactly as in 0014. A test starts two takes in parallel across a plan upgrade and proves the ceiling holds for whichever allowance was in force.
- **AC-5**: Data. Migration adds `billing_account` (`user_id` primary key, cascade delete with the user; `provider_customer_id` unique, nullable; `founding_member_at` nullable; `founding_price_locked` boolean, default false; `pending_checkout_id` and `pending_checkout_expires_at` nullable; `deleting_at` nullable; `recovery_subscription_id`, `recovery_started_at` and `recovery_after_payment_id` nullable; timestamps), `subscription` (`id`; `user_id` cascade; `provider_subscription_id` unique; `price_key`; `status` of `active`, `past_due` or `canceled`; `current_period_end`; `cancel_at_period_end`; `grace_until` nullable; `provider_updated_at`; timestamps; a partial unique index so one user has at most one non canceled subscription) and `billing_event` (`provider_event_id` primary key, `type`, `received_at`, `processed_at`). It also seeds the `billing_enabled` setting as `false` in `app_setting`. No card data, no address, no amount and no raw webhook body is stored.
- **AC-6**: Webhook endpoint `POST /api/webhooks/billing`. It reads the raw body, checks the provider's HMAC signature header with Web Crypto using a constant time compare and a 5 minute timestamp window, and answers 401 with no detail when the check fails. It has no session and no Origin check (server to server), is not part of the public API registry, and is rate limited by address. The body is parsed with zod; an event type we do not use is stored and answered 200. Only after the signature passes does anything else happen.
- **AC-7**: Idempotent and order safe. The first step in one transaction is `insert into billing_event ... on conflict do nothing`; if the event ID already exists the handler answers 200 and does nothing. Each state change carries the provider's own `occurred_at` and applies only if it is newer than `subscription.provider_updated_at`, so a retried or out of order delivery cannot move a subscription backwards. A failure inside the handler rolls back the event row and answers 500 so the provider retries.
- **AC-8**: Events handled: subscription created, updated (price change, renewal, cancel at period end set or cleared), canceled, past due, resumed; transaction completed (sets `active`, clears `grace_until`); payment failed (sets `past_due` and `grace_until = now + 7 days` once, never extended by retries); refund or chargeback adjustment (sets `canceled`, sets `current_period_end` to the event time and clears `grace_until`, so AC-2 ends the plan at once and paid time left is not honoured). Refund and chargeback adjustment payloads carry the provider `subscription_id` but no `custom_data.userId`, so they are matched through our `subscription` row by `provider_subscription_id` (never by email); an adjustment for a subscription we do not hold is stored and logged by event ID only, and ignored. A webhook whose opaque `custom_data.userId` does not match an existing user is stored and logged by event ID only; if it would create a subscription (a checkout that finished after the account was deleted, AC-17) we ask the provider to cancel it at once with a full refund, and any other kind is ignored; the customer's email is never used to match an account. Every handler is a pure decision (`planTransition(state, event)`) plus one write, so the rules are unit tested without a database.
- **AC-9**: Provider client. `src/server/billing/provider.ts` calls the provider with `fetch` and zod parsed responses (no SDK, as with R2 and Deepgram), as typed `Result`s: create a hosted checkout, create a short lived customer portal link, cancel a subscription. The API key comes from the Worker secret store and is read at call time. Sandbox and live are one setting, `BILLING_ENV`, which picks the base URL; a test proves the live URL is never used when it says sandbox.
- **AC-10**: Checkout. `POST /api/billing/checkout` (session, same Origin, 10 a hour per creator) takes only `{ interval: "monthly" | "yearly" }`. The server picks the price key itself: founding price if `billing_account.founding_price_locked` is true, else the standard price. It creates a provider transaction carrying `custom_data.userId` (our opaque ID) and answers with the provider's hosted checkout URL; the browser is redirected to it. The provider's transaction checkout URL is not a standalone page: it opens a payment link page on an approved domain that loads Paddle.js. So the default payment link is set to one dedicated page of ours, `/pay` (public, noindex, outside `AppShell`, no session or creator data, no analytics), the only page that loads the provider script (Paddle.js, from the provider's own domain, with a content security policy on `/pay` that allows it and nothing else). No other Take Studio page loads a provider script, and a test scans their source for it. It refuses (409) a creator who already has an effective paid plan, and refuses while `billing_enabled` is false. One checkout at a time. Before it reserves anything, the route reconciles: if the user has a non canceled `subscription` row that AC-2 already treats as free (a `past_due` row whose grace has run out, with the provider not yet having canceled it), it asks the provider for that subscription's real state, writes the result through `planTransition`, and then checks `effectivePlan` again. If the creator is now on a paid plan (the payment succeeded after local grace ran out but before its webhook arrived), the subscription is kept and the route answers 409 as above, with no cancel and no new checkout. Only a subscription that is still not paid is canceled at the provider, so the new checkout never meets an old row in the one slot. A test covers the recovered case. The cancel is not assumed to be conditional (the provider's cancel semantics are confirmed in the build task for this route, and a conditional cancel is used if the API offers one). Until then the route cancels only after the re-check, then reads the subscription once more. If that read shows a payment landed in the gap, the cancel has already ended a subscription the creator paid for, so the rule is: refund that last payment in full at once, record `canceled` with `current_period_end` set to now (AC-2 gives free, AC-8 immediate end), answer 503 with a plain message that nothing was charged and they can try again, and log the event ID only. The creator never keeps a charge without access. A test covers the payment landing between the re-check and the cancel. This recovery is durable and idempotent: before the cancel call the route writes `billing_account.recovery_subscription_id`, `recovery_started_at` and `recovery_after_payment_id` (the newest payment the re-check read saw, or none) in its own committed transaction. The refund call uses the provider subscription id as its idempotency key, so repeating it never refunds twice. A task `billing-recover` (Trigger.dev, every 15 minutes, IDs only in logs) finds every account with a recovery marker and finishes the work: it reads the subscription and its payments from the provider, refunds only the gap payment (a payment newer than `recovery_after_payment_id`, never an earlier period the creator already used) unless it is already refunded, writes `canceled` through `planTransition`, and clears the marker. The route itself runs the same function once inline; if the cancel, the read or the refund fails, it answers 503 and leaves the marker for the task. While the marker is set, checkout answers 503 (try again soon). A test fails each of the three calls once and checks the task completes the refund exactly once. A test with earlier paid periods and no gap payment checks that nothing is refunded. A provider cancel on a subscription that is already canceled counts as success (the task and the route treat the provider's already canceled answer as done, then go on to the read). Every local `canceled` write on this path (the recovery above, and the plain cancel of a still unpaid lapsed row) goes through `planTransition` once the provider accepts the cancel and before the replacement checkout is reserved, and it sets `founding_price_locked = false` in the same update. The provider's later cancellation webhook finds the row already `canceled` and is a no op (AC-7 ordering). If that call fails the route answers 503 and the creator retries. Then the route reserves `billing_account.pending_checkout_id` and `pending_checkout_expires_at` (30 minutes) in one conditional update, and a second request while one is live gets the same hosted URL back. The reservation is cleared when a subscription is recorded or it expires. If two subscriptions are created anyway (a reservation that expired mid-payment), the webhook records the first; for the second it stores the event, asks the provider to cancel it at once with a full refund, logs the event ID only and sends no email. A test covers it, so the partial unique index never silently rejects a paid subscription.
- **AC-11**: Portal and cancel. `POST /api/billing/portal` (session, same Origin) returns a fresh provider customer portal URL (card change, receipts, cancel). The URL is never stored or logged. Cancel from the portal arrives as a webhook (cancel at period end), so the page shows "Ends on 14 Jan" until then. Billing management is session only: API keys and MCP tokens cannot start checkout, open the portal or cancel.
- **AC-12**: Plan changes. Upgrading monthly to yearly, or founding price to standard (never offered), is done in the portal; the provider prorates and we only read the result (AC-8). Cancel and downgrade take effect at the end of the paid period (AC-2). A refund inside the provider's refund window ends the plan at once (AC-8). A new subscription after a cancel starts a fresh row.
- **AC-13**: Failed payment. The provider retries the card on its own schedule. On the first failure we start a 7 day grace (creator allowance kept), send one "payment failed" email with a link to the billing page, and show a banner on the library and billing page. If the provider cancels the subscription, or the grace ends first, the plan falls back to free (AC-2) and one "your plan ended" email is sent. A grace that ends first produces no provider event, so a scheduled task `billing-grace-expiry` (Trigger.dev, every 15 minutes, IDs only in logs) finds `past_due` rows with `grace_until <= now` and sends the email; its dedupe key is `grace-ended:<provider_subscription_id>:<grace_until>`, inserted into `billing_event` with `on conflict do nothing` before the send (the same dedupe as AC-7), so a rerun or a restart sends it once and never zero times. A test runs the task twice. Takes, transcripts and settings are never deleted or locked because of billing; retention (0013) is unchanged.
- **AC-14**: Founding members. `billing_account.founding_member_at` marks the badge and the welcome; `founding_price_locked` is the separate price right, and the grant sets both. A one time, owner run task (`founding-grant`, token gated like `usage-reconcile`, run by Toyin from the dashboard) sets it for the first 50 creators with at least 2 uploaded takes, ordered by the time of their second take, using the same query as the `/insights` count, and prints only a count. It is safe to run twice (it never changes someone already marked and never passes 50). Founding members get the same free allowance as everyone until they subscribe (C-26, C-30); when they do, the server gives them the founding price (AC-10) and the same 180 minutes. They get one welcome email when marked. Deleting an account removes both fields. The price right is lost for good when the subscription ends (cancel, payment failure or refund): the webhook handler sets `founding_price_locked = false` on every move to `canceled` (the badge stays), so a former member who comes back pays the standard price (stated in the copy). The same rule covers the local cancel paths of AC-10 (lapsed row cancel and payment gap recovery), which clear it in their own update; the webhook rule stays for every other cancel. A test proves cancel then a new checkout gets the standard price key.
- **AC-15**: The page. `/account/billing`, reached from the account menu, shows: current plan and renewal or end date, minutes used and left (the 0014 meter), a founding member badge when it applies, a "Choose monthly or yearly" upgrade for a free creator (the amounts come from the provider's price list through a cached, zod checked read, with a fixed fallback in copy), "Manage billing" for a paid creator, and the past due banner. The upload area and failed take message for `limit_exceeded` (0014 AC-9) gain an "Upgrade" link when billing is enabled. Accessible (WCAG AA, 44 px targets, status messages polite) and usable at phone width.
- **AC-16**: Emails (Resend, the spec 0006 helper): payment failed, plan ended, founding welcome. Plain, transactional, no marketing, no tracking links, sent once per provider event (deduped by event ID) or, for the grace expiry, once per `grace-ended:` key (AC-13), and they carry no amount, card detail or portal link; they link to the signed in billing page. Receipts and invoices are the merchant of record's job, not ours.
- **AC-17**: Account deletion. The delete flow (0013) first asks the provider to cancel any subscription (immediately, no refund unless the provider's policy says so), then deletes our rows. If the provider call fails, deletion stops with a clear message and the creator can retry; we never delete the account and leave a live subscription charging them. Deletion and webhook writes are serialised per user: both paths take a row lock on the user's `billing_account` row (`SELECT … FOR UPDATE`, created first if missing) inside their transaction. Deletion also refuses (503, try again soon) while `recovery_subscription_id` is set, so the cascade can never remove an unfinished refund obligation before `billing-recover` clears it; a test covers it. A provider cancel on a subscription that is already canceled counts as success. Deletion runs in this order: lock, cancel any live subscription and any open checkout (`pending_checkout_id`) at the provider, set `deleting_at` on `billing_account`, delete the rows, commit. A webhook that locks after `deleting_at` is set, or finds no user, cancels and refunds the provider subscription instead of recording it (AC-8). The cascade can therefore never remove a subscription row whose provider subscription is still active, and a payment that completes after deletion is refunded; a test runs both orders. Usage rows stay (0014 AC-10).
- **AC-18**: Switch and safety. While `billing_enabled` is false: no Upgrade link, checkout refuses, the page says plans are not on sale yet, and webhooks are still processed (so the sandbox can be tested end to end on production code). It is switched on by code in its own small PR that Michael merges on purpose, after the live account, price IDs and secrets exist (same pattern as `usage_limit_enabled`).
- **AC-19**: Analytics (spec 0016). Four new events join the closed list with strict props and no amounts, emails or provider IDs: `checkout_started` (`interval`), `subscription_started` (`interval`, `founding` true or false, once per subscription), `subscription_canceled` (`reason`: `by_creator`, `payment_failed`, `refund`) and `payment_failed` (none). `/insights` shows paying subscribers, founding members who subscribed out of the 50, and the checkout to subscription rate, as counts. Revenue is read from the provider's dashboard, not stored here.
- **AC-20**: Legal facts, in the same build PR (checklist in `src/lib/AGENTS.md`). `PROCESSORS` gains the provider (payments, merchant of record: it receives name, email, country, payment details and is the seller, and keeps its own tax records); `COLLECTED` gains the billing rows above (customer ID, subscription ID, plan, status, period end, founding flag), kept while the account exists; the secrets join the env list; the Terms gain plans, renewal, cancel, price change notice (30 days), refund policy, "the provider is the seller of record" and that deleting an account cancels the subscription; the Privacy copy says we never see card numbers. The checkout runs on the provider's script on `/pay` only, and `/pay` sets no cookie on our domain; the Privacy copy names the provider script on that one page. `LEGAL_VERSION` moves and Toyin's lawyer reviews the payment wording (the `test:legal-launch` gate stays red until it is recorded).
- **AC-21**: Private and observable. Logs, errors and reports carry event IDs, user IDs, status names and numbers, never emails, card or address data, portal links, signatures or the raw body. A signature failure is counted, not reported as an error. `billing_event` rows are purged after 90 days (the idempotency window is far shorter than that).
- **AC-22**: Test mode only until launch. All tests use the provider's sandbox shapes as synthetic, locally signed fixtures (no network to the provider in CI); one manual sandbox walk through (checkout with the provider's test card, failed payment, cancel, refund) is a checklist in the build PR and is run by Toyin once she has a sandbox account.

## Options considered

### Provider

**Option A: Paddle Billing (merchant of record). Recommended.** 5% + $0.50 a transaction. Pros: the most mature subscriptions tooling (dunning, prorations, customer portal, hosted checkout, a sandbox), handles sales tax, VAT and the paperwork in every country we sell to (C-30: worldwide), webhooks are a plain HMAC with a timestamp, so Web Crypto verifies them in a Worker. Cons: an application and website review before live (days to weeks, so Toyin should apply early), highest of the MoR fees after Stripe's, less friendly for tiny prices.

**Option B: Polar (merchant of record), runner up.** About 4% + $0.40 to 5% + $0.50 (sources disagree). Pros: developer first, open source, Standard Webhooks signatures, built for exactly this size. Cons: younger, fewer payout countries and less mature dunning and tax reporting; its fee history is changing. A good switch if Paddle's review is slow or refuses.

**Option C: Lemon Squeezy.** Same 5% + $0.50 plus 1.5% on international sales; Stripe now owns it and says it is building paths to Stripe Managed Payments, so its future is uncertain. Not recommended for a build that starts now.

**Option D: Stripe Billing plus Stripe Tax (we are the seller).** Cheapest per payment (about 3.4% to 4% + $0.30) and the best tooling. But we would own registration and filing for sales tax and VAT in every place we sell, which is the one thing a solo founder selling worldwide should not take on at 50 customers. Revisit past about $10 thousand a month in sales.

**Option E: Stripe Managed Payments.** Stripe's own merchant of record, 6% or more all in, newer and gated. Fine later if we move to Stripe; not now.

Whichever is chosen, the code keeps the provider behind `src/server/billing/provider.ts` and one webhook parser, so switching costs a few days, not a rewrite.

### Plan shape

**Option A: one paid plan, Creator, with a hard stop. Recommended.** Free 60 minutes; Creator **$19 a month or $190 a year** (two months free) for **180 minutes** a month. At the end of the allowance new takes wait for the 1st or an upgrade, as in 0014. Why: simplest to build and to explain; peers sit at $15 to $40 (research 2026-11-13); at the middle cost of $0.04 a minute a fully used plan costs $7.20 and nets about $10 after the $1.45 provider fee, and the high case ($0.07, $12.60) still leaves about $5. A hard stop keeps the cost ceiling that 0014 was built for.

**Runner up: two tiers**, Creator $19 for 180 minutes and Studio $49 for 600 minutes. Better later, when we see creators hit the cap; a second row in `PLANS` and a second set of price keys, no change to the flow.

**Overage or top up packs** (for example 60 minutes for $7): useful, but needs a separate one time purchase flow. Left for after we see who hits the limit.

**Cheaper alternative**: $15 for 120 minutes. Safer on cost (worst case $8.40) but a weak step up from 60 free.

### Founding member offer

**Recommended: a locked founding price of $12 a month or $120 a year** (about 37% off, same 180 minutes), for as long as the subscription stays active, for the first 50 founding members. A separate provider price, chosen by the server (never a coupon code that can leak). Why: it rewards the early supporters, costs us little at 50 people, and needs no discount logic.

**Runner up:** the first 3 months free then the standard price. Easier to explain, but it delays money and teaches people to cancel.

**Also considered:** founding members stay free forever. Generous, but it caps what 50 of our most engaged users ever pay and sets a precedent; rejected unless Toyin wants it.

### Trials

**Recommended: no card trial.** The free 60 minutes a month is the trial and needs no card. Runner up: a 14 day trial with a card (provider supported, more conversion, more refunds and chargebacks at this size).

### Month alignment

**Recommended:** keep usage on UTC calendar months (0014) and let the provider bill on the buyer's own cycle. Pros: no change to the usage table; the cost ceiling stays a calendar month. Cons: a creator who subscribes on the 25th gets a full 180 minutes for the last days of the month and again on the 1st. Accepted (bounded, rare). Runner up: reset on the billing date, which needs a usage month per subscription cycle and a migration of the 0014 table.

## Decision

**Option A for provider (Paddle Billing), Option A for plan (one paid plan, Creator, hard stop), the locked founding price, no card trial and calendar month usage.** Everything is built in sandbox. The prices, the minutes, the provider choice and the founding offer are **decisions for Toyin** (below); the build uses the recommended defaults until she answers, and each is one configuration value or one registry row so a different answer is cheap.

**Decisions for Toyin** (numbered, each with a recommendation, so Michael can pass them on):

1. **Provider.** Recommended: Paddle. Runner up: Polar. (Needs her to open and verify a seller account; start by about 1 December, because the review can take days.)
2. **Creator price and minutes.** Recommended: $19 a month, $190 a year, 180 minutes a month. Runner ups: $15 for 120 minutes, or two tiers ($19 for 180 and $49 for 600). Marked clearly as hers; the figures are not final until she says.
3. **Founding offer.** Recommended: $12 a month or $120 a year, locked while subscribed, first 50 only. Runner up: 3 months free.
4. **Cutoff for "founding member".** Recommended: the first 50 creators with 2 or more takes by the day billing opens. Runner up: only those who qualify by 31 December.
5. **Refunds.** Recommended: 14 days, no questions asked, through the provider.
6. **When to start asking them to pay.** Recommended: switch `billing_enabled` on once the sandbox walk through passes and the lawyer has reviewed the payment wording.

## Rationale

The usage limit already has the right seam (one allowance function, one atomic charge), so billing is a plan lookup, a way to change the plan safely, and the screens around it. Making the webhook the only writer keeps money logic out of the request path and gives one place to secure and test. A merchant of record is the right size for a solo founder selling worldwide: the extra 2 points of fees buy the removal of every tax filing. Hosted checkout and a portal keep card data and extra scripts off our pages, which keeps the cookie and privacy story as it is. One plan and a hard stop are the least we can build that still answers "I hit the limit, what now?", and the registry shape makes a second tier a small change.

## Feature design

**Data model sketch** (details in AC-5):

| Table | Columns | Rules |
|---|---|---|
| `billing_account` | `user_id` PK FK cascade; `provider_customer_id` unique null; `founding_member_at` null; `founding_price_locked` bool; `pending_checkout_id` and `pending_checkout_expires_at` null; `deleting_at` null; `recovery_subscription_id`, `recovery_started_at` and `recovery_after_payment_id` null; timestamps | one per user, created on first checkout or when marked founding |
| `subscription` | `id`; `user_id` FK cascade; `provider_subscription_id` unique; `price_key`; `status`; `current_period_end`; `cancel_at_period_end`; `grace_until`; `provider_updated_at`; timestamps | partial unique index: one non canceled row per user |
| `billing_event` | `provider_event_id` PK; `type`; `received_at`; `processed_at` | the idempotency record; purged after 90 days |
| `app_setting` | `billing_enabled` = false | switched on by code in its own PR |

**State transitions** (`subscription.status`): none to `active` (transaction completed); `active` to `past_due` (payment failed, sets grace); `past_due` to `active` (a later payment succeeds); `active` or `past_due` to `canceled` (canceled, refund, or provider gave up). `cancel_at_period_end` is a flag on `active`, not a state. `canceled` is final; a new subscription is a new row.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/webhooks/billing` | POST | raw signed body | 200 | signature | 401 bad signature, 500 retry |
| `/api/billing/checkout` | POST | `{ interval }` | `{ url }` | session, same Origin | 401, 403, 409 already paid, 409 not on sale, 429 |
| `/api/billing/portal` | POST | none | `{ url }` | session, same Origin | 401, 404 no customer |
| `/api/billing` | GET | none | `{ plan, status, periodEnd, cancelsAtPeriodEnd, graceUntil, founding, billingEnabled }` | session | 401 |
| `/api/usage` | GET | none | adds `plan` to the 0014 numbers | session | 401 |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Allowance for an account | seconds | `monthlyAllowanceSeconds(settings, plan)` where plan = `effectivePlan(subscription, now)` |
| Price shown on the page | amount and currency | the provider's price list read through `provider.ts` (cached about an hour, zod checked); fixed fallback copy |
| Which price a creator is sent to | `price_key` | the server: founding if `founding_price_locked` is true, else standard; the browser only sends the interval |
| Provider price ID | opaque ID | configuration per `price_key` (not secret, not typed in code) |
| Who a webhook is about | user ID | `custom_data.userId` set by us at checkout, checked to exist |
| Plan ends on | date | `subscription.current_period_end` (provider) |
| Grace ends on | time | `now + 7 days` at the first payment failure, stored |
| Founding member | yes or no | `billing_account.founding_member_at`, set once by `founding-grant` |
| Portal link | URL | created per request by the provider, never stored |
| `now` | time | one clock read per request, passed in |

**Pure rules** (`src/lib/plan-rules.ts`, with tests): `PLANS`, `effectivePlan`, `planTransition`, `graceUntil`, `priceKeyFor`, `planNotice` (the wording of the banners). No database, clock or network inside.

**Error handling**: provider calls return `{ ok: true, data } | { ok: false, error }`; checkout and portal failures show a friendly retry message and log the status only. A webhook that cannot be processed answers 500 so the provider retries; one that fails the signature answers 401.

**Security model**: the webhook signature is the only trust anchor for plan changes; secrets live in the Worker secret store; the browser can never choose a price or a plan; the plan is matched by our opaque user ID, never by email; checkout and portal are session only with the Origin rule and a rate limit; no card data touches our servers or pages.

**Performance**: one indexed read added inside the charge transaction; billing page reads two small rows and one cached price list.

**Testing approach**: pure tests for `effectivePlan` (every status and date edge, midnight), `planTransition` (every event, out of order, replay), and `priceKeyFor`; data tests on the real test database (parallel charges across an upgrade, grace expiry, one live subscription per user, cascade on delete); route tests (signature good, bad, stale, replay, unknown user, unknown type); provider client contract tests with a fake `fetch` and zod; browser tests with the provider stubbed (upgrade, portal, banner, axe, phone width); a pipeline check (`PIPELINE_ONLY=billing`) that posts locally signed fixtures at a running app and watches the allowance change and a take start; one manual sandbox walk through (AC-22).

## Build plan

Tracer Bullet: prove one thread first (a signed webhook that raises the allowance and lets a take start), then the way in (checkout), then the screens, emails, founding and legal.

1. `src/lib/plan-rules.ts` with tests; `monthlyAllowanceSeconds` takes the plan; call sites updated, free behaviour unchanged. Satisfies **AC-1**, **AC-2**, **AC-3**.
2. Migration (three tables, `billing_enabled` setting) and data functions to read and write them, with tests. Satisfies **AC-5**.
3. The plan read inside `startJob`, `POST /api/uploads` and `GET /api/usage`, with the parallel upgrade test. Satisfies **AC-4**, **AC-3**.
4. Webhook route: signature, zod, idempotency, ordering, `planTransition` handlers, and the pipeline check with signed fixtures (the tracer thread ends here: webhook, allowance, take starts). Satisfies **AC-6**, **AC-7**, **AC-8**, **AC-21**.
5. Provider client (`fetch` plus zod): checkout, portal, cancel, price list; sandbox only; contract tests. Satisfies **AC-9**.
6. Checkout and portal routes, `GET /api/billing`, the rate limit, and cancel on account delete. Satisfies **AC-10**, **AC-11**, **AC-12**, **AC-17**.
7. The billing page, the upgrade links at the limit, and the banners (Dwight, needs Mobbin), with browser tests and axe. Satisfies **AC-15**, **AC-13** (banner).
8. The three emails with dedupe, grace and plan ended handling. Satisfies **AC-13**, **AC-16**.
9. `founding-grant` task, welcome email, and the `/insights` founding count reuse. Satisfies **AC-14**.
10. Analytics events and the `/insights` billing counts. Satisfies **AC-19**.
11. Legal facts, Privacy and Terms copy, `LEGAL_VERSION`, `pnpm legal:drift`. Satisfies **AC-20**.
12. Sandbox walk through checklist, run by Toyin with her sandbox account. Satisfies **AC-22**.
13. Go live, in its own small PR: live secrets and price IDs in place, `billing_enabled` switched on by code, runbook line for rollback (set it back, the plan data stays). Satisfies **AC-18**.

Tasks 1 to 6 are Jim; 7 is Dwight; 8 to 11 are shared by who is free; 12 and 13 need Toyin's account and Michael's merge. Month 2 starts in mid December, so tasks 1 to 6 should be done by the time Toyin has the provider account.

## Consequences

**Positive**:
- Creators who outgrow 60 minutes can pay; Toyin never handles tax or card data.
- One function and one webhook own plan changes, so the usage limit flow is untouched.
- Founding members are recognised with a price lock that costs us little.

**Negative / tradeoffs**:
- A full 180 minutes is available the day a creator subscribes, even late in the month (bounded and accepted).
- Fees of about 5% plus $0.50 a payment, and a second company holding customer billing records.
- A hard stop means a paying creator who runs out must wait or upgrade; no overage yet.
- The provider review is outside our control and can delay launch; Polar is the fallback.
- Prices in the cost table are estimates until the `ai-eval` and render timing runs come back.

**Neutral**:
- Re renders, background changes, cut changes and AI edits stay uncounted (0014), now for paying creators too.
- API keys and MCP tokens get the plan's allowance automatically but cannot manage billing.

## Follow-up

- [ ] Toyin's decisions 1 to 6 above (through Michael, as numbered options, C-30 pattern). Provider account application should start by about 1 December.
- [ ] Replace the cost estimates with measured numbers: the `ai-eval` and `ai-measure` runs (C-29) and a render time per video minute from `job_step` timings; revisit the price if the middle case moves above about $0.06 a minute.
- [ ] Toyin's lawyer reviews the payment, refund and subscription wording (AC-20); `pnpm test:legal-launch` stays red until recorded.
- [ ] Scope: the "Billing & plans" entry leaves Deferred and becomes feature 22 (this PR).
- [ ] After the build: `/sync` adds plan rules, billing data and server notes to `src/lib/AGENTS.md`, `src/db/AGENTS.md` and `src/server/AGENTS.md`.
- [ ] Later: a second tier, top up packs, an email at 80% used, and moving to Stripe Billing plus Tax if sales pass about $10 thousand a month.

## References

**Project sources**:
- Specs 0014 (usage limit and the allowance seam), 0016 (analytics events, founding members), 0015 (legal facts), 0013 (account deletion), 0006 (Resend), 0018 and 0019 (API and MCP act as the owner), 0012 (AI cost)
- `src/lib/usage-rules.ts`, `src/lib/analytics-events.ts`, `src/lib/legal-facts.ts`, `src/db/data/jobs/initial.ts`, `trigger.config.ts`
- Commitments C-26 (founding members and billing in month 2), C-30 (worldwide, minimum age, recommended options), C-29 (AI cost measured in Trigger.dev cloud)
- `docs/scope/research/2026-11-13-creative-director-research.md` (peer prices, $0.05 a minute AI estimate)

**External (checked 2026-11-15; sources disagree on some fees, confirm on the vendor page before signing)**:
- [Merchant of Record in 2026: Paddle, Stripe, Polar and Lemon Squeezy](https://alexcloudstar.com/blog/merchant-of-record-indie-saas-2026/)
- [Paddle vs Lemon Squeezy 2026](https://resources.rework.com/tools/billing-revenue/paddle-vs-lemon-squeezy)
- [Cheapest merchant of record platforms 2026](https://dupple.com/learn/cheapest-merchant-of-record-platforms)
- [Trigger.dev pricing](https://trigger.dev/pricing) (medium-1x $0.000085 a second)
