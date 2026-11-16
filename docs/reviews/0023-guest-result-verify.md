# Verify: guest result view in the drop card (B2-T183, spec 0023 AC-10)

Run on branch `b2-t183-guest-result-view` with main merged in (#383 and #384 are in). This is the runtime check for the player only. The full Upload first report is `0023-upload-first-verify.md`.

## What was checked

| Check | Result | How |
|---|---|---|
| After the email step the card polls `GET /api/guest/take` and shows a short status first | pass | e2e: the first answer is `processing`, the card says it is working on the take |
| When the take is ready a player shows the finished video | pass | e2e: `video` with the label "Your finished take", `src` is the play link, `controls` on |
| View only: no download, no edit | pass | e2e: `controlslist` has `nodownload`, no download link or edit control exists in the card; the right click menu is off |
| "Check your email to keep it" stays visible the whole time | pass | e2e checks it before, during and after the player appears |
| A failed take says so in words and keeps the email note | pass | e2e with a `failed` answer |
| Keyboard | pass | the player takes focus and uses its own native keys; the focus outline is the project one |
| Screen reader | pass | the status line is a `role="status"` region (preparing, ready, failed); the player has an `aria-label` |
| Axe | pass | no serious or critical issues with the player showing |
| Phone width, 44 px targets | pass | the existing phone width spec still passes; the player is full width with native controls |
| Existing drop card specs | pass | `home-drop.spec.ts` 4 passed, 1 skipped (the no key case, by design) |
| Unit tests, typecheck, lint, `check:lines` | pass | 2721 unit tests pass; typecheck and lint clean; no file over 250 lines |

Screenshots: `docs/reviews/screenshots/0023-guest-result-desktop.png` and `0023-guest-result-phone.png`.

## Design check

There is no reference draft for the result state (`docs/design/upload-first-reference.md` covers the drop zone, the email step and the claim screen only), and the idle homepage is unchanged because the result renders only after the upload is done. So no side by side run applies. The card uses the existing tokens and the project focus outline.

## Gaps and choices

- No caption track is shown. The route answers `{ status, playUrl, expiresInSeconds }` and has no captions link, so there is nothing to attach. If captions for guests are wanted, the route needs to offer a track first.
- The play link is refreshed one minute before it expires and is kept in memory only.
- `controlsList="nodownload"` is a browser hint, not a lock. A guest who copies the link from the network panel can still fetch it. That matches the spec's view only meaning (no download control), and the link lasts one hour and is for the guest's own take only.

## Needs a deployed check

The play link itself: a real presigned R2 link that the browser can stream (range requests, CORS for the media host, and the one hour expiry refresh). The e2e fakes it, because CI's storage is a stand in.
