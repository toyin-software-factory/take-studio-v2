# Verify: spec 0023 drop card polish (B2-T184)

Checked on the built Worker preview (127.0.0.1:8787) with Cloudflare's Turnstile test key. The guest routes and storage are stubbed, as in the other drop card specs. All six items are advice in the browser only; the server checks stay the authority.

## Results

| # | Item | Result | Proof |
|---|------|--------|-------|
| 1 | Too long check before upload | Pass. The length is read from the video's metadata (`read-duration.ts`, 1.5 s wait). Over 180 s is refused before any request is sent; unreadable lets it upload. | `home-drop.spec.ts` (stubbed 240 s length, zero create requests), unit tests over, at the limit, under, unreadable. `0023-polish-too-long.png` |
| 2 | Numbers in the refusals | Pass. "(500 MB)" and "(3 minutes)" come from `guest-rules.ts`, never typed. | `guest-drop.test.ts` |
| 3 | File row and tick | Pass. Name, then "30 KB · 0:03" under it; at 100% the bar becomes a tick. | `0023-polish-uploading.png`, `0023-polish-tick-step3.png`, e2e |
| 4 | Three step indicator | Pass. Visual bars are hidden from screen readers, which hear "Step n of 3: name". | e2e, `0023-polish-*.png` |
| 5 | Stop headings | Pass. "That's all the free tries for now", "Free tries are paused" with the one email line. "We kept your file." shows only beside Try again, which re-sends the same file object. | `0023-polish-guest_budget_spent.png`, `0023-polish-guest_paused.png`, `0023-polish-failed.png` |
| 6 | Invalid email line | Pass. "Enter a real email address, like name@example.com." | e2e, `0023-polish-email-error.png` |

Kept as they were: the result player, the unavailable state, and the result gone and failed states. Nothing else was taken from the design file (no invite form, no "coming soon" labels, no example caption with a name).

## Checks

- `home-drop.spec.ts` and `home-drop.result.spec.ts`: 8 passed, 1 skipped (the no key case).
- Axe on the card while uploading: no serious issues. Keyboard paths and the live status region are unchanged; buttons stay 44 px or more.
- Lint, typecheck, `check:lines`, `legal:drift` and the full unit run (2737 passed) are clean. Phone width (390 px) screenshots: `0023-polish-phone-*.png`.

## Gaps and choices

- On the stop screens the indicator stays on step 1, because nothing was chosen successfully.
- A video whose length the browser cannot read in 1.5 s uploads; the server check still applies.

## Needs a deployed check

Reading the length of a real phone recording (a `.mov` from an iPhone) in Safari, where metadata loading can be slower. The e2e stubs the length.
