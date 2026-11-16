# Verify: Turnstile Privacy Addendum link (B2-T185), 2026-11-16

**Verdict: PASS locally. One check needs a deployed page.**

## What was checked

You can see the change on `/privacy`, under "Who else handles your data", in the Cloudflare Turnstile entry.

| Check | Result |
|---|---|
| The entry names Cloudflare Turnstile and shows one sentence with a link | Pass (screenshots in the PR, desktop and phone) |
| The link goes to `https://www.cloudflare.com/turnstile-privacy-policy/`, opens safely (`rel="noopener noreferrer"`) | Pass (read from the rendered page) |
| Only the Turnstile entry has a link | Pass (a test pins it) |
| The new copy has a recorded hash, history is sound | Pass (`legal-copy.test.ts`, `legal-text-hashes.test.ts`) |
| `pnpm legal:drift` | Clean |

`LEGAL_VERSION.privacy` is already `2026-11-16`, which is today, so it cannot move later. The new hash line repeats the date, which the history rules allow.

## Needs a deployed check

- Open the deployed Privacy page and click the link. This sandbox could not load Cloudflare's page (its servers refuse automated requests with a 403), so the live page was not opened from here. The URL was confirmed from Cloudflare's own documentation.
