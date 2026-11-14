# Launch device pass: scripts for the human run

Written for B2-T102. It closes the parts of the launch UI review (items 3 and 5, in `launch-ui-review.md`) and of spec 0021 (AC-1, AC-5, AC-7, AC-10) that only a person on a real device can confirm. Playwright already covers what an engine can show (see "What the machines already cover" at the end), so these scripts only ask for what a machine cannot judge.

## Before you start

- **Use a test setup, never production.** Production sign in is not part of this pass (C-31). Use a local build (`pnpm db:up && pnpm db:migrate && pnpm build:worker`, then `pnpm preview`) or a preview environment that Michael or Jim gives you, with a throwaway test account. Open it on the phone through an HTTPS address that the phone trusts: a phone treats a plain `http://` network address as not secure and then refuses the camera and microphone, so the recording rows cannot run. Use a preview environment with HTTPS, or a local certificate: make one with `mkcert` for your computer's network address, install its root certificate on the phone and trust it, then start the preview with Wrangler's HTTPS settings (`WRANGLER_HTTPS_KEY_PATH` and `WRANGLER_HTTPS_CERT_PATH` set to the two files, and `pnpm preview` run so that Wrangler listens on the network address, for example with its `--ip 0.0.0.0` option). `pnpm preview` alone serves plain `http://` and does not work for the phone. This route has not been tried in the sandbox, so if it does not come up, ask Michael or Jim for a preview environment instead. On Android Chrome only, you may instead allow the one test address in `chrome://flags`, Insecure origins treated as secure. Never use a public link to real data.
- **Use made up takes only.** Never open or upload a creator's video. To get a take to look at:
  1. Open `/library` signed in as the test account.
  2. Press Choose a video and pick `tests/fixtures/media/speech-en.mp4` (a synthetic voice clip, copy it to the phone first) or `tests/fixtures/media/keyed-lime.mp4`.
  3. Wait for the take to say Ready. This is "your test take" below.
  4. For the cut timeline, use a take whose cuts were found (the speech clip has pauses). If no cuts show, say so in the result column.
- **Use a made up script** for the recorder, for example: "This is a test script. The quick brown fox jumps over the lazy dog." Never a real one.
- Fill the Result column with `pass`, `fail` or `n/a`, plus a short note and the device, OS and browser version. A fail needs one line saying what you saw. Do not paste tokens, links or screenshots of anything real.

What "pass" means everywhere: nothing is cut off, nothing scrolls sideways, every button can be pressed with a thumb or the keyboard, every spoken name makes sense without seeing the screen, and nothing you made is lost.

## 1. iPhone, Safari, with VoiceOver

Turn VoiceOver on in Settings, Accessibility. Swipe right and left to move, double tap to press. Portrait first.

| # | Route and steps | Pass looks like | Result |
|---|---|---|---|
| 1.1 | Open `/` (landing). Swipe through the whole page. | Headings read in order, buttons say what they do, the page does not scroll sideways, text is readable without zooming. | |
| 1.2 | Open `/sign-in`. Swipe to the email field and the buttons. | The field is announced as Email, both ways to sign in are reachable. | |
| 1.3 | Sign in, open `/library`. Swipe through your test take card. | The card says its title and status. Delete says which take it deletes. | |
| 1.4 | Open `/record`. Press Turn on camera. Allow the camera and microphone. | The live preview shows (AC-1). You can pick the camera and microphone, and flip the camera. | |
| 1.5 | Paste the made up script, press Record. | A 3 second countdown is announced, then recording starts and the timer runs. Stop is reachable on the first screen without scrolling. | |
| 1.6 | Record about 10 seconds in portrait, press Stop, then Use this take. | The upload finishes and the take opens. It plays on the phone and the file is an MP4 in portrait (AC-10). | |
| 1.7 | Start another recording, then lock the phone for 10 seconds, unlock. | The recording says clearly what happened and offers a way forward, and nothing is lost (AC-7). | |
| 1.7a | Start another recording and do not touch the phone for longer than its auto lock time (Settings, Display, Auto-Lock; set it to 30 seconds first). | The screen stays on and the recording keeps running the whole time (AC-7, the wake lock). Set Auto-Lock back afterwards. | |
| 1.8 | During a recording, press the Back button of the browser. | A leave confirmation appears before you lose the take (AC-7). | |
| 1.9 | Open your test take. Swipe through the player, the cut timeline and the cut list. | Each cut is announced with its time range and reason. Undo and Redo are announced and the change is spoken. Arrow keys are not needed. | |
| 1.10 | In Settings, Safari, deny the camera for the site and open `/record` again. | A plain message says the camera is blocked and how to fix it, and Upload a file instead is offered (AC-5). | |
| 1.10a | In Settings, Safari, set the site's Camera and Microphone back to Ask or Allow, then reload `/record`. | The camera turns on again, so the recording rows below can run. | |
| 1.11 | Turn the phone sideways on `/record` and on the take page. | Nothing is cut off and nothing scrolls sideways. Turn back to portrait when done. | |
| 1.12 | Motion: open `/` and scroll the page, open `/record` and go through the countdown and recording, open your test take and press Undo and Redo on a cut. Then turn Reduce Motion on in Settings, Accessibility, Motion and repeat. | No movement feels too large, too fast or distracting, and with Reduce Motion on the movement is gone or much calmer. Write down any motion that felt too much. | |

## 2. Android phone, Chrome, with TalkBack

Turn TalkBack on in Settings, Accessibility. Swipe right and left to move, double tap to press. Portrait first.

| # | Route and steps | Pass looks like | Result |
|---|---|---|---|
| 2.1 | Open `/` and swipe through the landing page. | Same as 1.1. | |
| 2.2 | Open `/sign-in`, sign in, open `/library`. | Same as 1.2 and 1.3. | |
| 2.3 | Open `/record`, Turn on camera, allow both permissions. | Live preview, camera and microphone pickers, flip camera (AC-1). | |
| 2.4 | Paste the made up script, Record, wait through the countdown, record 10 seconds, Stop, Use this take. | Countdown, timer and Stop work. The take uploads and plays. The file plays back in portrait (AC-10). | |
| 2.5 | While recording, switch to another app for 10 seconds and come back. | Recording state is clear on return, or the take is kept with a way forward (AC-7). | |
| 2.6 | Turn on airplane mode just before pressing Use this take, then turn it off. | The upload fails with a plain message, the take is kept, Try again and Save to your device are offered, and Try again works (AC-7). | |
| 2.7 | Open your test take. Swipe through the cut timeline and cut list, press Undo on a cut. | Same as 1.9. | |
| 2.8 | In Chrome site settings, block the camera for the site and open `/record`. | Blocked message and Upload a file instead (AC-5). | |
| 2.8a | In Chrome site settings, set the site's Camera and Microphone back to Ask or Allow, then reload `/record`. | The camera turns on again, so the recording rows below can run. | |
| 2.9 | Rotate to landscape on `/record` and the take page, then back. | Nothing is cut off, no sideways scroll. | |
| 2.10 | Open the take you recorded on the iPhone in step 1.6 (sign in as the same test account on this phone) and press Play. | It plays with sound and picture, in portrait (AC-10). | |
| 2.11 | Start a recording and do not touch the phone for longer than its screen timeout (Settings, Display, Screen timeout; set it to 30 seconds first). | The screen stays on and the recording keeps running (AC-7, the wake lock). Set the timeout back afterwards. | |
| 2.12 | Motion: open `/` and scroll the page, open `/record` and go through the countdown and recording, open your test take and press Undo and Redo on a cut. | No movement feels too large, too fast or distracting, and nothing is needed to understand what is on screen. Write down any motion that felt too much. | |

## 3. Desktop Safari (macOS), with VoiceOver

Start VoiceOver with Command and F5. Move with the VoiceOver keys (Control and Option plus the arrow keys), press with Control, Option and Space.

| # | Route and steps | Pass looks like | Result |
|---|---|---|---|
| 3.1 | Open `/sign-in` and `/library`. | Headings, field names and card names read sensibly. | |
| 3.2 | Open `/record`, allow the camera and microphone, Record 10 seconds, Stop, Use this take (AC-1, AC-10). | Preview shows, pickers list your devices, the take uploads and plays in Safari. | |
| 3.2a | Open the take you recorded on the iPhone in step 1.6 and press Play. | It plays with sound and picture in Safari (AC-10). | |
| 3.3 | Tab through `/record` setup, record and review with the keyboard only. | Focus is always visible, nothing traps you, Stop and Use this take are reachable. | |
| 3.4 | Open your test take. Tab to the cut timeline, use the arrow keys between cuts, press Undo and Redo. | Each cut is announced with its time and reason, the change is announced, focus stays sensible. | |
| 3.5 | Safari, Settings, Websites, Camera: set the site to Deny, reload `/record`. | Blocked message and Upload a file instead (AC-5). | |
| 3.6 | Set the site's Camera and Microphone back to Ask or Allow, reload `/record`, turn the camera on and start a recording. Then try to leave by closing the tab. | The browser asks before the take is lost (AC-7). Cancel the close and stop the recording. | |

## 4. Desktop Firefox (any system), with NVDA on Windows if you have it

If you only have a Mac, run steps 4.1 to 4.5 without a screen reader and mark 4.6 as `n/a`.

| # | Route and steps | Pass looks like | Result |
|---|---|---|---|
| 4.1 | Open `/sign-in` and `/library`. | Everything is visible and readable, no sideways scroll. | |
| 4.2 | Open `/record`, allow the camera and microphone, Record 10 seconds, Stop, Use this take (AC-1, AC-10). | Preview shows, take uploads and plays. Note the file type if the take page shows it. | |
| 4.2a | Open the take you recorded on the iPhone in step 1.6 and press Play. | It plays with sound and picture in Firefox (AC-10). | |
| 4.3 | Block the camera for the site (the address bar permission icon) and reload `/record`. | Blocked message and Upload a file instead (AC-5). | |
| 4.4 | Unplug or disable the camera (or use a machine with none) and open `/record`. | No camera found message and Upload a file instead (AC-5). | |
| 4.5 | Open your test take, use the keyboard on the cut timeline and the cut list. | Arrow keys move between cuts, focus is visible, Undo and Redo work. | |
| 4.6 | NVDA on: repeat 4.5 and the `/record` flow. | Cuts, buttons, the countdown, the timer and errors are all announced in a way that makes sense. | |

## What only a real device can confirm

These cannot be settled by Playwright, so each is on this pass:

- Real camera and microphone on iPhone Safari, Android Chrome, desktop Safari and Firefox, including the pickers and flipping the camera (AC-1).
- That the recorded file really is an MP4 on iPhone Safari and plays everywhere, and that a portrait phone gives a portrait file (AC-10).
- The real permission prompts and what each browser's own settings page calls things (AC-5).
- Background interruption, a locked phone, a dropped connection and the screen staying awake (AC-7).
- How VoiceOver, TalkBack and NVDA actually sound on the cut timeline and the recorder (launch UI review item 5).
- Whether motion feels too much and the reading order feels right on a phone (launch UI review item 3).

## What the machines already cover

`tests/cross-browser.spec.ts` runs the sign in page, the library, a ready take page and the `/record` permission states (blocked, no device, busy) in Safari's engine (WebKit) and Firefox's engine with the `webkit` and `firefox` Playwright projects, in CI as the `browsers` shard. The camera is a stub there, because those engines have no fake camera switch. Chromium covers the rest of the recorder in `tests/record-failures.spec.ts`, `tests/record-a11y.spec.ts` and `tests/record-limits.spec.ts`, and the cut timeline in `tests/cut-review.spec.ts`. WebKit and Firefox in Playwright are not iOS Safari or the Firefox app, so a green run there is not a replacement for this pass.

## When you finish

Send Michael the filled tables. Each fail becomes a task. If every row passes, the launch UI review items 3 and 5 and spec 0021 AC-1, AC-5, AC-7 and AC-10 can be ticked.
