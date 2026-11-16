# Upload first: design reference (spec 0023 build step 8 prep)

This is a reference for the homepage drop zone, the email step and the claim screen. It is not code to copy. Build to `design.md`, spec 0023 and the accessibility rules in `src/components/AGENTS.md`. Spec 0010 owns the homepage, so the hero change is agreed there.

Numbers such as file size, length, expiry and daily counts are written here as "the spec's settings". Toyin may change them, so the UI reads them from settings and never hard codes them. All screens below are from Mobbin (web). They are other products' screens, used only as ideas. No real people appear in this file.

## The three screens

1. **Drop zone** on the homepage, accepts a file before sign up, shows progress.
2. **Email step** right after the upload, "where should we send it", no account yet.
3. **Claim or check your email** screen, after the email is sent.

## Mobbin patterns

### Screen 1: the drop zone

**P1. WeTransfer, send panel on the homepage** (flow: Onboarding)
https://mobbin.com/flows/49e5582d-a6d5-4d4c-b8b2-914ab50907d8
- Does well: the file picker and the email fields live on one small card, with one primary button at the bottom. Nobody is asked to sign up first.
- We take: one card, file first, email second, a single primary action.
- Fit: the card sits in the hero beside or under `h-lead`, using `--color-surface` on white or the glass card on dark, `--radius-lg`, and the primary pill from `design.md`. It does not replace the fan. On phone it stacks under the lead.

**P2. Docusign, "Uploading a document"**
https://mobbin.com/screens/1be38a75-2fc5-48c9-8257-df4d1b108f5b
- Does well: the thumbnail shows a spinner and a thin progress bar while the next fields (names, emails) are already open below. The person keeps working during the upload.
- We take: show the email field as soon as a file is chosen, while the upload runs. The upload never blocks typing.
- Fit: the progress row is a bar built from `--color-ink` on `--color-line`, with the file name in `--fs-small`. No thumbnail of the video frame is needed in v1.

**P3. Remote, "Upload your resume"** (success state)
https://mobbin.com/screens/d8a30d6d-a843-4314-b063-f1b1652f0e77
- Does well: the dashed zone itself turns into the result, with a plain success line, the file name, size and a remove button. Rules (type, max size) sit in small text inside the zone before any error.
- We take: the zone changes in place for each state, and the rules show up front in muted small text.
- Fit: dashed border in `--color-line-strong` (needs 3:1), text `--color-text-muted`, success text in `--color-ink`.

**P4. Gamma, "Import"**
https://mobbin.com/screens/5fec65f1-5771-424d-bf73-f43f636fa1ff
- Does well: the sentence is "Drag a file or click to upload", with a big clear target and one icon. Short and honest.
- We take: both ways in one sentence, plus a visible button. Our copy is "Drop your video here or choose a file".
- Fit: the choose button is a real `<button>` (primary pill, 48px) inside the zone, not only a link in a sentence.

### Screen 2: the email step

**P5. Air, "Ready to submit?"**
https://mobbin.com/screens/74df0c03-7bf6-4c08-a79d-874dbc85e09b
- Does well: after the upload finishes, one small panel asks only for an email and a name. The terms line sits right under the fields. A toast says the upload is complete.
- We take: ask for the email once, with the notice line under it, and show a quiet "upload complete" confirmation first.
- Fit: we ask for the email only (no name). Use the form style in `design.md` (labels 14px muted above, 48px fields, ink focus line) so it matches the contact form on the homepage. Inline, not a modal, so focus and the page scroll stay simple.

**P6. WeTransfer, sign up screen** (Onboarding flow)
https://mobbin.com/flows/49e5582d-a6d5-4d4c-b8b2-914ab50907d8
- Does well: one email field, one Continue button, the legal line under it, nothing else above the fold.
- We take: the same shape for our email step: one label, one field, one button, one notice line. No password.

### Screen 3: claim or check your email

**P7. Elicit, "Verify your email"**
https://mobbin.com/screens/90f09e18-3fc2-4a9c-ad43-8a6fbfb8a474
- Does well: shows the address that was used, one line of what to do, "Open Gmail" and "Open Outlook" shortcuts, and under them "Wrong account?" and "Didn't get a link? Resend".
- We take: repeat the address, name the next step, and give both Resend and Use a different email.
- Fit: centred card, `--fs-h3` heading, body in `--fs-body`, links as text links with the `design.md` focus outline. Open mail shortcuts are optional and only if they are plain links.

**P8. Loom, "Verify your email"**
https://mobbin.com/screens/c3760374-ad5a-4310-8f3a-b1ac67789d5e
- Does well: tells the person to check spam, says how long the link lasts, and has the resend button right there.
- We take: a spam hint and the link lifetime (the spec's settings) in the body text.

**P9. PlanetScale, resend with a toast**
https://mobbin.com/screens/b118fbad-2c7b-4d15-8957-2d7c42e3fea7
- Does well: pressing Resend gives a small confirmation toast ("An email is on its way"), and Update email sits beside it.
- We take: a polite live confirmation after Resend, and a visible way to correct the address.

## Where the pieces go

| Piece | Where | Notes |
| --- | --- | --- |
| Drop card | `src/components/home/` as its own file next to `hero.tsx`, imported by the hero | Keep each file under the line limit. Heavy upload code stays out of the web bundle until used. |
| Email step | Same card, replaces the drop area once a file is accepted | Same container so the page does not jump. |
| Claim or check email | A state of the same card, plus the `/claim` page | The `/claim` page uses the signed out layout (nav and footer). |
| Styles | New block in `src/components/home/styles/` | Tokens only, no raw hex. |

## States

Each state keeps the same card size so nothing shifts. Every message names the next step in plain words. Copy is a suggestion for Toyin to approve.

1. **Idle.** Dashed zone, upload icon, "Drop your video here or choose a file", a primary Choose file button, and one muted line with the spec's settings (accepted types, biggest size, longest length). Notice that no account is needed.
2. **Drag over.** The border turns solid `--color-ink`, the background tints to `--color-surface`, and the text changes to "Drop to upload". This is extra, never the only way in. Do not rely on colour alone: the text changes too.
3. **Uploading.** File name, a progress bar and a percent. The email field is open right away (P2). Cancel is a real button. Text: "Uploading. Keep this tab open." The bar's width eases only if motion is allowed.
4. **Too big or too long.** Nothing is uploaded. For a size failure, message: "That video is larger than we can take for a free try. Choose a smaller file or sign in to upload a larger one." For a length failure, message: "That video is longer than we can take for a free try. Trim it or sign in to upload a longer one." Name the spec's settings and never write the numbers into the UI code. Offer Choose another file. For a length check done after the file is read, show the length message in the same place.
5. **Guest limit reached.** For the daily or active upload limits and the kill switch. Message: "You have reached the free try limit for now. Sign in to keep going, or come back tomorrow." Show a Sign in link and no drop zone, so it does not look broken. If the whole feature is off, say that uploads are paused and point to Sign in.
6. **Email sent.** The claim screen (P7, P8): the address, "Open the link in your email to keep your take", spam hint, link lifetime from settings, Resend and Use a different email. After Resend, a short confirmation (P9). Also say what happens if they never click: the upload is removed after the spec's expiry setting.
7. **Error.** Upload failed, network dropped, bot check failed, or email could not be sent. Message names the cause and the next step: "The upload stopped. Check your connection and try again." with a Try again button that keeps the chosen file if it can. Never show codes, IDs, links or file contents.

## Keyboard and screen reader

- The zone holds a real `<input type="file">` and a real `<button>`. Drag and drop is an extra. Enter and Space on the button open the file picker.
- The input has an accessible name ("Choose a video") and an `accept` list from the spec's settings. A hidden input is reached only through the button, never by tab order duplicates.
- Focus order: choose button, then email field, then Send. After a file is accepted, focus stays where it is or moves to the email field only if the person was on the choose button. Never move focus on its own while someone is typing.
- One polite live region (`role="status"`) announces progress at coarse steps (for example start, halfway, done) so it does not chatter. Errors go to `role="alert"` and also get text on screen. The progress bar uses `role="progressbar"` with a name and value.
- When the state changes to Email sent, move focus to the new heading (`tabindex="-1"`) so keyboard and screen reader users land on it.
- The email field has a visible label, `type="email"`, `autocomplete="email"` and an error message tied to it with `aria-describedby`.
- No keyboard trap. Escape cancels nothing destructive.
- Text and controls meet WCAG AA contrast. Add any new colour pairing to `src/app/design/contrast-table.ts` with a reason.

## Targets, motion and phone width

- **44 px targets.** Choose file, Cancel, Send, Resend and the links in the card are all at least 44 px high and wide, with space between them. The primary pill is already 48 px.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, no bar easing, no drag pulse, no card swap animation. States change instantly and the live region still speaks. The fan toggle rules in `design.md` still apply to the hero.
- **Phone width (about 400 px).** The card is full width with at least the 16 px page gutter, stacked under the lead. Fields and buttons are full width. Dragging is not the main way on a phone, so Choose file is the larger, first control. The file picker on phones can offer the camera roll, which is fine. Nothing scrolls sideways.
- **Dark and light.** The hero follows the existing homepage surface. Use the primary pill on dark where the card is on `--color-dark`.

## Privacy and copy checks

- The notice under the email field links to Privacy and Terms, per the legal facts rules. Any change that adds a cookie, a stored field or an email send also updates `src/lib/legal-facts.ts` and `LEGAL_VERSION`.
- Never show or log a file name in reports or error pages that leave the browser.
- No stock photos of real people on this card. Use the device frames and card colours already in `design.md`.

## Open questions for Toyin

- Should the card live inside the hero or directly under it? (Spec 0010 owns the layout.)
- Final copy for the limit and expiry messages.
- Whether to add "Open Gmail" and "Open Outlook" shortcuts on the claim screen.
