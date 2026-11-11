# Verify: error monitoring, spec 0005

**Verdict: PASS, with one confirmation owed.** Seven of the eight acceptance criteria are met with evidence from this run. The weekly report part of AC-7 cannot be read with the Sentry token we have, so it needs a person to look (details under "Owed"). Nothing failed.

**Update 2026-11-11 (lead):** Toyin confirmed in Sentry that the weekly report is on for take-studio and that the first seen email for today's check errors arrived. AC-7 is now fully met, so all eight criteria pass.

Run on 2026-11-11 against the live app (release `b70536a`), Sentry's API (read only), the unit tests and the real deploy log. No personal data and no secrets are in this report; it uses event IDs, run IDs and PR links only.

## Result per acceptance criterion

| AC | What it asks | Result | Evidence (IDs only) |
| --- | --- | --- | --- |
| AC-1 | A route, server component or Worker error reaches Sentry with environment, release and `service: web` | Met for a route handler (see notes) | Event `4cb89cbb4825498b8a38ca3471c56050`: `service: web`, `environment: production`, release `b70536a`, route `/api/sentry-check`. Two hits 21 seconds apart gave two events (`d8c6d707d3df441f965d8a315f3e6437`, `709bfb3f5d654ea4b9ace571543ce9ca`, release `dc9dfe2`, before the `service` tag existed). |
| AC-2 | A browser error reaches Sentry with the same release and `service: browser` | Met | Event `eff05e646e064384b593328fd97bf01d`: `service: browser`, `environment: production`, release `b70536a` (same release as the web event). |
| AC-3 | A task's final failure carries `service: jobs`, task name, run ID, attempt, only allowlisted ID tags, never the payload | Met | Event `83b3329afb634c3d9346df32c1e51e1e` from run `run_06gskpblk25qsav1ign00n5ba2`: tags `service: jobs`, `task: sentry-check`, `runId`, `attempt: 1`, and no other custom tags. The event has only an exception entry: no payload, no extra data, no request. |
| AC-4 | No personal or secret data sent or stored | Met | Sentry project: `scrubIPAddresses` true, server side `dataScrubber` true, a data scrubbing rule removes `user.geo`. All three events: no user field at all. The web event's request has no headers, query, cookies or body, and no long secret looking string appears anywhere in it. 16 scrubbing tests pass (presigned and R2 URLs, emails, query strings, bodies, cookies, headers, `{ id }` only user, allowlisted extras). |
| AC-5 | Errors only: no tracing, replay, feedback or profiling | Met | In the last 7 days Sentry stored only the `error` category (12 events) and nothing else. Code: `tracesSampleRate: 0`, and no replay, feedback or profiling integration exists anywhere in `src` or the config. |
| AC-6 | Source maps for web and jobs uploaded in the CI deploy; maps not served publicly; Worker frames resolve to `src/` | Met | Deploy run 43015793707 log: Next maps uploaded, 156 server maps inlined with 0 failed, Worker map uploaded. All 14 client chunks the live site serves carry a debug ID that Sentry holds a map for (14 of 14), and the live Worker's debug ID is held too. Every `.map` URL tried on the live site answers 404. Frames: web event ends at `src/app/api/sentry-check/route.ts` line 18; jobs event ends at `src/trigger/sentry-check.ts` line 21. The deploy script's stop conditions (failed upload, no `src/` sources, inline map) are pinned by 14 tests (11 that run the real script with fake tools, 3 on the step order). |
| AC-7 | First seen email; spike email over 10 in 1 hour; weekly report on; Dedupe off so repeats count | Met for the rules and Dedupe; weekly report owed | Workflow `1480966`: enabled, trigger first seen, action email to active members. Workflow `1481027`: enabled, trigger more than 10 events in 1 hour, action email to active members. Dedupe off proven by two hits giving two events. |
| AC-8 | Without a DSN the app and jobs run and build; the Worker stays within the limit | Met for the app and the Worker; jobs checked in part (see notes) | App and Worker: CI runs with no Sentry DSN and is green on main (`36273dd`, `babb10f`), including the browser test "without a DSN the app sends nothing to Sentry, even on a browser error". The Worker deployed: the total upload was 3694 KiB gzipped (assets and Worker together) and Cloudflare accepted it. Jobs: with no DSN and no auth token, `trigger.config.ts` loads (it adds no Sentry build plugin) and `src/trigger/init.ts` starts with the Sentry client disabled, no DSN and no transport, and a capture does not throw (run in this check). |

## Owed (not a failure, needs a person)

- **AC-7, weekly report.** In Sentry the weekly report is a per person email setting. It is not part of the project or organization data, and the API token we have gets a 403 on it. Toyin can confirm in Sentry under account settings, notifications, "Weekly Reports" (it is on by default). Until then this one part is unverified.
- **AC-7, the emails themselves.** Both rules exist and are enabled, but this run did not see an email arrive. Toyin can say whether the first seen email arrived for the check errors from today. The spike rule was not fired on purpose (it would email Toyin).

## Not exercised, and why

- **AC-1, server component and Worker level errors.** Only a route handler error was triggered in production. A server component error goes through the same `onRequestError` hook and a Worker level error through the same `withSentry` wrapper, but no throwing page or Worker path exists to call. The spec's own critical test scenario for AC-1 is the route, which was exercised.
- **AC-6, a browser frame from our own code.** The deliberate browser error is thrown from the console, so its only app frame is anonymous. As a direct check instead, every served client chunk was matched to an uploaded map by debug ID (14 of 14).
- **AC-8, a full jobs build without a DSN.** CI does not build or run the Trigger.dev jobs, and the unit tests cover job helpers, not job startup. This check loaded the jobs config and started the jobs' Sentry init with no DSN, which shows it is safe, but no `trigger deploy` build or real job run without a DSN was done.
- **AC-6, "a failed upload stops the deploy before production changes".** Shown by the tests and by the order of the deploy steps (the build, check and upload run before the migration), not by breaking a production deploy.

## Worth knowing (works, but fragile or surprising)

- Frames show the note `js_missing_sources_content`: the maps carry file names and lines but not the source text, so Sentry shows no code lines around a frame. That is by design (sources are not uploaded).
- On job events Sentry replaces our `runtime` tag with the Node version, so search jobs by `service:jobs`.
- The check token lives in two places (the Worker secret and the Trigger.dev Production environment). A new production check needs both set to the same new value.
- Spec 0005 still says `runtime: web` in its first "Critical test scenarios" line; AC-1 says `service: web`. Small leftover for `/architect`.

## Failing

None.
