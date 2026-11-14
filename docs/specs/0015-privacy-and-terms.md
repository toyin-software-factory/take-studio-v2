# 0015. Privacy and terms pages

**Date**: 2026-11-14
**Status**: Proposed

## Summary

Take Studio stores people's videos, so it needs a public Privacy page and a Terms page that say, truthfully, what we do with them. This spec adds the two pages at `/privacy` and `/terms`, links them from the landing footer, the sign in form, the upload area and the signed in menu, and keeps the words true by building every number and every named service in the copy from the same code that does the work, with tests that fail when the code and the copy drift apart. We are not lawyers: the copy is a plain language first draft, a lawyer must review it before launch, and Toyin must supply the legal facts (company name, address, contact, governing law) that no code can know.

## Context

The scope promises "public privacy policy and terms, linked from the landing page and sign up, and the privacy page states the 30 day video retention and delete anytime promise". Today the landing footer has only a contact email (`content.ts`: "Privacy and Terms join this column when scope feature 16 ships"), the sign in page has no notice, and nothing tells a creator who sees their video.

What the product really does, from the code and earlier specs (this is the fact base the copy must match):

- Videos: the original and the finished video are kept 30 days from upload completion, then deleted by a sweep every 15 minutes (spec 0013). Transcripts, cuts and edits stay until the take is deleted. A creator can delete a take any time, which removes every file and row (spec 0013 AC-3, AC-6). R2 lifecycle rules delete files at 35 days as a backstop.
- Accounts: sign in by Google or an emailed link (spec 0006). We hold the email, the name and picture Google gives us, and session rows with IP address and user agent (Better Auth `session` table). The only cookie is the Better Auth session cookie. There is no analytics, advertising or tracking cookie today. Account deletion (`deleteUser`, spec 0002 AC-17) removes all takes and files, but there is no button for it yet: only the server side exists.
- Usage limit (spec 0014): seconds of take length are counted per month under an HMAC of the canonical email, so the count survives account deletion and holds no readable email or ID. This is personal data in a weak form and the policy must say it.
- Sign in limits keep a SHA 256 of the email for 15 minutes (spec 0006). Take ready and failed emails go through Resend, with a one click turn off link.
- Services that touch creator data: Cloudflare (Workers hosting, R2 file storage), Neon (Postgres database), Trigger.dev (runs the video jobs, sees file keys and IDs, with video bytes passing through its machines), Deepgram (receives the audio for the transcript, with `mip_opt_out=true` so it is not used for their model training), Anthropic (receives transcript words and pause positions, never video or audio, spec 0012 AC-8), Resend (email address and message), Sentry (error reports, scrubbed to IDs, spec 0005), Google (sign in).
- Not true, so never to be claimed: "we never share data" (we use the services above), "we never keep anything after deletion" (the usage count stays), "no cookies" (the session cookie exists).

Forces: copy that drifts from the product is worse than no copy, because it is a promise; the next features change the facts (analytics, feature 17, adds a tool and maybe a cookie; billing adds a payment processor; the public API adds API keys); and none of this can be decided by engineers alone because it is legal text.

## Requirements

**User stories**:
- As a creator, I want to read in plain words what happens to my video, my transcript and my email, and who else sees them, before I sign up.
- As a creator, I want to know how to delete my take and my account, and what stays behind.
- As the product owner, I want the pages to stay true when the code changes, and to know what a lawyer must still check.

**Acceptance criteria**:
- **AC-1**: `/privacy` and `/terms` are public (no session needed), render as normal server pages without client JavaScript for the text, appear in the sitemap, are allowed by robots, and have a title, a description and a canonical link. A signed in creator sees the same pages (no redirect to the library).
- **AC-2**: The pages are linked from: the landing footer (the Legal column, beside the contact email), a notice under the sign in form ("By continuing you agree to the Terms and the Privacy Policy", both links), a one line note in the upload area that links the Privacy page next to the 30 day note, and the signed in user menu. Links are real anchors, keyboard reachable, 44 px targets where they are tappable on a phone.
- **AC-3**: The Privacy page states, from code constants and never typed numbers: the 30 day video retention (`VIDEO_RETENTION_DAYS`), that transcripts and cuts stay until the take is deleted, that a creator can delete any take at any time with everything removed, how to delete the account and what that removes, the monthly allowance and that the usage count is kept after account deletion as a keyed hash with no readable email, and the upload limits (`MEDIA_LIMITS`).
- **AC-4**: The Privacy page names every processor with what it receives and why, from one registry (`PROCESSORS` in `src/lib/legal-facts.ts`): Cloudflare, Neon, Trigger.dev, Deepgram, Anthropic, Resend, Sentry and Google sign in. It states that Deepgram is told not to train on our audio, that Anthropic gets words and pause positions but never video or audio, and that we do not sell data or use creator content to train models. Each of these statements is a registry field the test in AC-9 checks against code.
- **AC-5**: The Privacy page lists what we collect (email, name and picture from Google, take titles, videos, transcripts, usage seconds, session records with IP address and user agent, sign in limit hashes), why, and how long each is kept, from one table in `legal-facts.ts`. It names the cookie (one session cookie, needed to stay signed in) and says there is no advertising or analytics cookie. It lists the creator's choices (delete a take, delete the account, turn off take emails, contact us) and the contact route for a data request.
- **AC-6**: The Terms page covers: who may use it (age floor from the decision below), the account and magic link rules, what the creator owns (the creator keeps all rights in their videos and transcripts and gives us only the right to process and show them to the creator), what is not allowed to upload, the 30 day and delete rules, the free monthly allowance and that it can change, availability without a guarantee, and a limit of liability and governing law that read from the facts Toyin supplies. Wording is plain, short sentences, and marked as a draft until the legal review is recorded (AC-11).
- **AC-7**: Every page shows a "Last updated" date and a version from `LEGAL_VERSION` (`privacy` and `terms` each hold an ISO date). A change to the page text without a new date fails a test (AC-9). Changes that matter (a new processor, a longer retention, a new use of content) also require a visible notice to signed in creators through the existing email path, decided with Michael when it happens (not built here).
- **AC-8**: Legal facts that only Toyin can supply (company name, postal address, contact email for privacy requests, governing law and venue, effective date) live in one place (`LEGAL_ENTITY` in `legal-facts.ts`, with `null` until supplied). While any is `null` the build still works, the page shows no invented value, the pages carry a visible "Draft, pending review" banner, and a test fails the launch gate (a separate `pnpm test:legal-launch` check, run before the switch to launch, not in the normal suite) until every value is filled and the review is recorded.
- **AC-9**: The copy stays true by test. A unit test fails when: a processor secret group in the env schemas has no registry entry (mirrors `deploy-env-list.test.ts`), a new runtime dependency in `package.json` is neither in an allowlist of known non-data tools nor in the registry (so an analytics or payments SDK cannot slip in), `DEEPGRAM_OPTIONS.mip_opt_out` is not `"true"`, Sentry options set `sendDefaultPii` true, the retention or limits numbers shown differ from the rule constants, or the rendered text of a page changed while its `LEGAL_VERSION` date did not (a stored hash over the legal copy only: the text inside the `data-legal-copy` region of each page, normalized, which includes every allowance wording variant (limit on, limit off, unavailable) as a fixed template whose only dynamic part, the minutes, is replaced by `{minutes}`, so a wording change is caught and a setting change is not. The Draft banner, header and footer sit outside that region, so showing or hiding the banner never changes the hash).
- **AC-10**: A change checklist in `src/lib/AGENTS.md` and in the PR template area of `AGENTS.md` says: a change that adds a service, a cookie, a stored field, a retention change, a new event or a payment step must update `legal-facts.ts` and the copy, and bump the date. `/sync` is told to flag a diff that touches the listed files without touching `legal-facts.ts`.
- **AC-11**: The legal review is a recorded gate, not an assumption, and it is bound to the text that was reviewed. `legal-facts.ts` carries `REVIEW = { reviewedBy, reviewedOn, privacyVersion, privacyTextHash, termsVersion, termsTextHash, allowanceMinutes, limitEnabled }`, all `null` until a lawyer signs off. The Draft banner goes, and `pnpm test:legal-launch` passes, only when every field is set and `privacyVersion` and `termsVersion` equal the current `LEGAL_VERSION` dates and both text hashes equal the hashes of the current normalized page text (the same hashes AC-9 uses), and the allowance state read from the settings of the database the check runs against (`DATABASE_URL_DIRECT`, so the launch run points at the launch database) equals `allowanceMinutes` and `limitEnabled`. If those settings cannot be read, the launch check fails; it never passes on a guess. The allowance is bound too: `allowanceMinutes` (and `limitEnabled`) are the values the lawyer saw, and the Draft banner also shows on the live page whenever the allowance state it displays (read from the settings at request time) differs from them, so changing `free_monthly_seconds` after sign-off brings the banner back until the new value is reviewed and recorded. A copy change after sign-off therefore brings the banner back and fails the launch check until the changed page is reviewed again. A small PR that Michael merges sets the fields after Toyin sends the lawyer's sign off.
- **AC-12**: Both pages meet WCAG AA: one `h1`, ordered headings, a table of contents with anchors on the long page, AA contrast on the light and dark themes, visible focus, readable line length, and print friendly. They use the existing design tokens (design.md) and the landing footer and header, not new components.
- **AC-13**: Account deletion is honest. Until a self serve Delete account control exists, the Privacy page says how to ask by email and that it is done within 30 days; the copy reads that state from `ACCOUNT_DELETE_SELF_SERVE` in `legal-facts.ts`. When the control ships (decision 4) the flag flips and the copy changes with it, proven by the same test.

## Options considered

### Option 1: Code driven pages with a facts file and drift tests (chosen)

Two server rendered pages whose numbers, processors and retention table come from `src/lib/legal-facts.ts` and the existing rule constants, with tests that tie the facts to the env schemas, `package.json`, Deepgram and Sentry settings.

**Pros**:
- Reuses how the landing page already builds true copy from rules (`content.ts`).
- The common drift (a new tool, a changed number) fails CI instead of being noticed by a lawyer or a customer.

**Cons**:
- Some drift (a new use of data in a prompt) a test cannot see; the checklist and the review cover it.

### Option 2: Static legal text from a generator or template service

Paste text from a policy generator into two pages.

**Pros**:
- Fastest; looks complete.

**Cons**:
- Generic words say things we do not do and miss things we do (usage hash survives deletion, Trigger.dev sees the video); nothing keeps it true.

### Option 3: Link to a hosted policy service

Embed a third party hosted policy and cookie banner.

**Pros**:
- The vendor keeps it current for common cases.

**Cons**:
- A new processor and script on every page, a cost, and still not specific to our flow; a cookie banner we do not need.

## Decision

**Chosen option**: Option 1: Code driven pages with a facts file and drift tests.

Two plain language pages built from one facts file, with a recorded lawyer review as the launch gate.

Decisions taken as recommended defaults (Toyin may change any; see Follow up for the numbered questions):

1. Consent: a notice line under the sign in form with links, no checkbox, and no acceptance stored for now.
2. Minimum age: 16.
3. Where data is held and what law applies: written for worldwide use with a clear "who processes your data and where" list; no region specific promises until a lawyer says so.
4. Account deletion: build a self serve Delete account control (a confirm dialog in the account menu using the existing `deleteUser`), as a separate small task after the pages, because the copy says "delete any time".
5. Processors are named in the open, each with what it receives and why.
6. Notice of changes: the "Last updated" date on the page now; an email notice for material changes decided when one happens.

**Implementation skills**: `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`) · `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`)

## Rationale

The facts a privacy page must state are already in code as constants and registries, so the cheapest way to keep promises true is to render from them and test the ties that matter most: the list of services, the Deepgram and Sentry settings, and the numbers. Every other approach leaves the words to be checked by memory.

A notice line instead of a checkbox follows from the product: it is free, accounts are made by one click Google or an email link, and a checkbox adds friction to the first thing a creator does. Whether a checkbox or a stored acceptance is needed is a legal question, so it is on the review list and cheap to add later (the facts file would carry a version, and one column could store the accepted version).

## Feature design

**Data model sketch**: no migration. Optional later (only if the lawyer wants stored acceptance): `user.accepted_terms_version text null`.

**Files**:
- `src/lib/legal-facts.ts` (pure, no side effects): `LEGAL_ENTITY`, `LEGAL_VERSION`, `REVIEW`, `ACCOUNT_DELETE_SELF_SERVE`, `PROCESSORS` (id, name, role, receives, doesNotReceive, location, trainsOnContent: false, envGroups), `COLLECTED` (what, why, kept, deletedWith). Numbers are imported from `take-rules`, `usage-rules`, `deepgram` and `site` (the contact email), never retyped.
- `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` (`dynamic = "force-dynamic"` because the allowance is read from the setting at request time; the rest of the text is fixed; default exports for pages only), with copy components in `src/components/legal/` (one section per component, past 150 lines split).
- `src/components/auth/sign-in-form.tsx` notice; the upload area note; the landing footer Legal column in `content.ts`; the user menu links in `src/components/shell/user-menu.tsx`; sitemap and robots.

**Value sourcing** (every value the pages show, and where it comes from):
| Page value | Source |
|---|---|
| Video retention days | `VIDEO_RETENTION_DAYS` (`take-rules`) |
| Upload limits (minutes, GB, resolution, types) | `MEDIA_LIMITS` (`take-rules`) |
| Monthly allowance, and whether it applies | The effective values, not constants: the page reads `free_monthly_seconds` and `limitEnabled` (`usage_limit_enabled`) from `app_setting` through the same `readUsageSettings` the upload check uses, and the minutes come from `monthlyAllowanceSeconds(settings, account)`, divided by 60 (spec 0014 AC-2). The public pages pass a fixed `PUBLIC_VIEWER` (the standard free account, a constant in `legal-facts.ts`) as the `account` argument and never read the session for it, so the page cannot vary by reader even after a per account override exists; a test fails if the page code reads the session for this value and the page states the standard free allowance. `FREE_MONTHLY_SECONDS_DEFAULT` (3600) is only the fallback the settings read already applies. When `limitEnabled` is true the page says "free accounts get N minutes of processing a month, currently, and this can change". When it is false the page says there is no monthly limit for now, that one is planned, and that this page will be updated first; it states no number. If the read fails the page shows neither: it says the current allowance is temporarily unavailable and that the creator's own usage meter shows what is left. |
| Processor names, purpose, data received | `PROCESSORS` in `legal-facts.ts`, checked against env schemas and `package.json` (AC-9) |
| Deepgram does not train | `DEEPGRAM_OPTIONS.mip_opt_out` (`src/lib/deepgram.ts`), asserted by test |
| Anthropic receives words and positions only | spec 0012 AC-8 (the request builder's input type), named in the registry and linked to its test |
| Cookie name and purpose | Better Auth config (`src/server/auth.ts`), registry field, checked by test that no other cookie is set in the web layer |
| Session record fields | `session` table (`ip_address`, `user_agent`), listed in `COLLECTED` |
| Contact email | `CONTACT_EMAIL` (`src/lib/site.ts`) until Toyin supplies a privacy specific address |
| Company name, address, governing law, effective date | `LEGAL_ENTITY`, supplied by Toyin (`null` until then, AC-8) |
| Last updated, version | `LEGAL_VERSION`, bumped by hand; the text hash test forces the bump (AC-7, AC-9) |
| Account deletion route | `ACCOUNT_DELETE_SELF_SERVE` (AC-13) |
| Draft banner | `REVIEW` and `LEGAL_ENTITY` completeness (AC-8, AC-11) |

**Key invariants**:
- No number, service name or retention period in the copy is typed by hand when a constant exists.
- No new processor, cookie, stored personal field or analytics event reaches main without a `legal-facts.ts` change and a version bump (tests plus checklist).
- The pages never log, store or personalise anything about the reader; they are public, and the only thing read per request is the allowance setting.

**Security model**: public read only pages; no new route accepts input. The sign in notice adds no data collection. Contact details come from the facts file, never from user input.

**Configuration required**: none (the facts file holds the entity values once Toyin supplies them).

**Critical test scenarios**:
- Happy path: `/privacy` and `/terms` render signed out and signed in with their dates, the numbers match the rule constants, verifies **AC-1**, **AC-3**.
- Links: footer, sign in notice, upload note and user menu each link to both pages, verifies **AC-2**.
- Processor drift: add an env group or a dependency not in the registry and the test fails; set `mip_opt_out` false and it fails, verifies **AC-4**, **AC-9**.
- Version drift: edit the normalized text without a date change and the hash test fails, verifies **AC-7**, **AC-9**.
- Review binding: with `REVIEW` filled, editing a page's text (or its date) brings the banner back and fails `pnpm test:legal-launch`, verifies **AC-11**.
- Allowance wording: editing any of the three allowance variants (limit on, limit off, unavailable) changes the hash and fails the date test; with settings unreadable the launch check fails, verifies **AC-9**, **AC-11**.
- Allowance: change the `free_monthly_seconds` setting in a test database and the page shows the new minutes (or the no limit wording while `usage_limit_enabled` is false) and the Draft banner returns (the reviewed value no longer matches); a failed settings read shows "temporarily unavailable", never the default as current, verifies **AC-3**, **AC-11**.
- Draft state: with `LEGAL_ENTITY` values null the banner shows and no invented value appears; `pnpm test:legal-launch` fails until filled and reviewed, verifies **AC-8**, **AC-11**.
- Account deletion honesty: with the flag false the page says to email; true, it names the control, verifies **AC-13**.
- Accessibility: axe on both pages in light and dark, keyboard focus order, verifies **AC-12**.

## Build plan

Tracer Bullet: one thin thread first (a real page from the facts file, linked and tested), then thicken.

1. `legal-facts.ts` with the registries, the entity placeholders and the drift tests (env groups, dependencies, Deepgram, Sentry, numbers, text hash), satisfies **AC-4**, **AC-5**, **AC-7**, **AC-8**, **AC-9**, **AC-11**, **AC-13**
2. The Privacy page from the facts, the footer link and the sitemap, with the draft banner and the date, satisfies **AC-1**, **AC-3**, **AC-5**, **AC-7**
3. The Terms page, satisfies **AC-1**, **AC-6**
4. The sign in notice, the upload note and the user menu links (this one touches shared UI, Dwight may take it), satisfies **AC-2**
5. Accessibility and print pass with axe and browser tests, satisfies **AC-12**
6. The change checklist in `src/lib/AGENTS.md` and root `AGENTS.md`, the `/sync` flag, and `pnpm test:legal-launch`, satisfies **AC-10**, **AC-8**
7. Separate task, after the pages: the self serve Delete account control (confirm dialog, fresh session guard, signed out redirect, test that nothing is left) and the flag flip, satisfies **AC-13**
8. Launch gate, when Toyin has the lawyer's sign off and the facts: fill `LEGAL_ENTITY` and `REVIEW` (including the reviewed versions and hashes), remove the draft banner, run `pnpm test:legal-launch`, satisfies **AC-8**, **AC-11**

## Consequences

**Positive**:
- Promises on the page are the product's real behaviour, and the likeliest drifts fail CI.
- The legal facts and the review each have one place and one gate, so nothing is guessed.

**Negative / tradeoffs**:
- Adding a dependency or a service now needs a registry line and a date bump.
- The copy is a draft until a lawyer reviews it; shipping the pages before then must keep the visible draft banner.

**Neutral**:
- No migration. Analytics (feature 17) and billing will each need a registry entry and a copy change; the tests will say so.

## Follow-up

Open questions for Toyin, sent to Michael as numbered options (recommended first):

- [ ] 1. Who is the operator named on the pages? (a) Your company name, postal address and a privacy contact email, to fill in `LEGAL_ENTITY` (recommended). (b) A personal name and address as a sole trader. (c) Launch with the contact email only, and keep the Draft banner until the rest is ready.
- [x] 2. Governing law and where disputes are heard? (a) The country and state or city where the company is registered (recommended; the lawyer confirms). (b) A neutral choice such as England and Wales. (c) Leave to the lawyer. Toyin chose (a) (C-30): the company's country, which the lawyer confirms; the value stays in `LEGAL_ENTITY` until supplied.
- [x] 3. Agreeing to the terms: (a) A notice under the sign in form, no checkbox, nothing stored (recommended). (b) A checkbox that must be ticked before sign in. (c) A notice plus storing the accepted version on the account. Toyin chose (a) (C-30): `AGREEMENT = "notice"`.
- [x] 4. Delete account: (a) Build a self serve button now, as a separate small task, and say "email us" on the page until it ships (recommended). (b) Email only for launch, button later. Toyin chose (a) (C-30): `ACCOUNT_DELETE_SELF_SERVE = false` until the button ships.
- [x] 5. Minimum age: (a) 16 (recommended, the common safe line). (b) 18. (c) 13. Toyin chose (a) (C-30): `MINIMUM_AGE = 16`.
- [x] 6. Where we serve: (a) Worldwide, with the processor list showing where data is held, and the lawyer says if EU or UK rules need more (recommended). (b) Limit sign up to certain countries. Toyin chose (a) (C-30): `SERVICE_REGION = "worldwide"`.
- [x] 7. Telling people when the policy changes: (a) The "Last updated" date, plus an email for material changes (recommended). (b) The date only. Toyin chose (a) (C-30): `CHANGE_NOTICE = "date_and_email"`.
- [ ] 8. Does Toyin want the lawyer to review: the whole Privacy and Terms copy (required before launch), the usage count that survives account deletion (a keyed hash with no email; should we keep it and say so, or delete it with the account and lose the abuse protection), the Terms limit of liability, and the sending of audio and transcript words to Deepgram and Anthropic? These are flagged for the review, not decided here.
- [ ] Facts Toyin must supply before the Draft banner can go: company legal name, postal address, privacy contact email, governing law and venue, the effective date, the lawyer's name and review date.
- [ ] Verify at build time that each processor's current terms say what the registry claims (Deepgram opt out, Anthropic API data use, Trigger.dev and Neon data handling). The registry is our statement, the lawyer confirms the vendor side.
- [ ] Optional later: add a Privacy link to the take ready and failed emails; a stored accepted version if the lawyer asks for it.

## References

**Project sources** (verifiable, in this repo):
- Specs 0002 (data model, account deletion), 0005 (error monitoring scrub), 0006 (sign in and email), 0007 (transcripts, Deepgram), 0012 (what Anthropic receives), 0013 (retention and delete), 0014 (usage hash)
- `src/lib/site.ts` (contact email), `src/components/home/content.ts` (footer Legal column), `src/lib/deepgram.ts` (`mip_opt_out`), `src/lib/deploy-env-list.test.ts` (the pattern for AC-9)

**Practices & standards**:
- Data minimisation and purpose limitation, and naming sub processors in a privacy notice (common GDPR practice; a lawyer confirms what applies)
- Tying published promises to code with tests, the way the landing page builds copy from the rule constants
