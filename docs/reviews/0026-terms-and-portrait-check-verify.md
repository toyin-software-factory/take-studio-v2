# Verify: credit Terms change and portrait check (B2-T180), 2026-11-16

**Verdict: PASS for the Terms change and for the portrait check after the fix. The check found a problem at the first inset; Michael decided 14% top and 6% left for portrait, and it is in this PR.**

## Terms change (AC-13)

| Check | Result |
|---|---|
| Terms say free account videos end with the credit; as is takes and originals carry none; old videos never get one | Pass (new "The Take Studio credit" section, in the table of contents) |
| The "process and show" sentence allows adding the credit | Pass |
| No paid removal sentence while billing and the removal are not live | Pass (left out on purpose, true in both states) |
| New text hash line, history sound | Pass (`legal-copy.test.ts`, `legal-text-hashes.test.ts`) |
| `pnpm legal:drift` | Nothing flagged. `PROCESSORS` and `COLLECTED` do not change |
| Signed in creators see a notice, nothing stored | Pass: library page, 14 days from the Terms date, unit tests cover the edges |

## Portrait check (5a)

A 1080 by 1920 frame was rendered with the real overlay filter and marked with the top and side areas the apps use. At the first inset (10%, x 54, y 192) TikTok's top bar was clear but Instagram Reels' published safe zone (14% top, 6% sides) was not. Michael decided on 14% top and 6% left for portrait (landscape and square stay 5% and 5%, no problem seen). The credit now sits at x 65, y 269, 432 by 52 px, just below the Reels top zone (screenshot below, the orange line is 14%, the red line is TikTok's top bar). The zones come from third party guides and Meta's Ads Guide, not from the apps. Result recorded in spec 0026, Follow-up.

Screenshot: https://raw.githubusercontent.com/toyin-software-factory/take-studio-v2/pr-assets/B2-T180/portrait-credit-new-inset.png

## Needs a deployed or manual check

- Look at a real credited portrait take inside the TikTok and Reels apps, once credit is live on a test account.
- The email to signed in creators for a material change (spec 0015 decision 7) is not sent by this task.
