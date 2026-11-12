# Take Studio design

The design system every screen follows. Decided with Toyin in spec 0003 (`docs/specs/0003-design-system.md`). Before building or changing any screen, read this file and pull fresh Mobbin references for the pattern you are building (team rule); link them in the PR.

## Direction

**Light app, dark stage.** The app is a calm, warm, light workspace (cream background, white cards, deep blue text). The video player and the cut timeline sit on a dark "stage" panel, like an editing desk, so video and studio backgrounds show true to colour. Soft corners, roomy spacing. One light theme for now; colours are tokens so a dark mode can be added later.

## Colour tokens

Palette (Toyin's): Molten Lava `#780000`, Brick Red `#C1121F`, Papaya Whip `#FDF0D5`, Deep Space Blue `#003049`, Steel Blue `#669BBC`. Status colours (added for status labels and icons only, never large areas): green `#2E6B3F`, amber `#8A5A00`, error red `#9B0D18`.

Light app:

- `--bg`: `#FDF0D5` (Papaya Whip), page background
- `--surface`: `#FFFFFF`, cards, dialogs, menus, inputs
- `--hover-surface`: `#003049` at 6% over the current surface, hovered rows and ghost buttons
- `--selected-surface`: `#C1121F` at 8% over the current surface, with a 3 px `--primary` left bar for the active nav item and selected rows
- `--text`: `#003049` (Deep Space Blue), body and headings (12.3:1 on bg, 13.8:1 on white)
- `--text-muted`: `#4C6A73`, secondary text and input placeholders (5.1:1 on bg, 5.8:1 on white)
- `--border`: `#B1B6AB`, dividers only (decorative, 1.8:1); card edges rely on the shadow
- `--border-strong`: `#728688`, input and control borders (3.4:1 on bg, 3.8:1 on white)
- `--primary`: `#C1121F` (Brick Red), main buttons, links, selection (5.5:1 on bg, 6.2:1 on white)
- `--primary-fg`: `#FFFFFF`, text on primary (6.2:1)
- `--primary-hover`: `#780000` (Molten Lava), primary hover; `--primary-active`: `#5A0000`, pressed (white on it 14.6:1)
- `--danger`: `#9B0D18`, error text, error icons and destructive buttons (7.6:1 on bg, 8.5:1 on white); `--danger-hover`: `#780000`
- `--danger-bg`: `#9B0D18` at 8% over surface, inline error alerts
- `--success`: `#2E6B3F` (5.7:1 on bg, 6.4:1 on white); `--success-bg`: 8% tint
- `--warning`: `#8A5A00` (5.3:1 on bg, 5.9:1 on white); `--warning-bg`: 8% tint
- `--info`: `#2F6690`, info text and progress fill on light (5.4:1 on bg, 6.1:1 on white); `--info-bg`: 8% tint
- `--disabled-bg`: `#003049` at 6%; `--disabled-fg`: `#003049` at 45% (disabled controls are exempt from contrast but keep their label, use `aria-disabled`, and show a not allowed cursor)
- `--focus`: `#C1121F`, 2 px ring with 2 px offset on light surfaces
- `--backdrop`: `#003049` at 60%, behind dialogs and sheets

Dark stage (player, timeline, processing preview):

- `--stage-bg`: `#003049` (Deep Space Blue)
- `--stage-raised`: `#1F495F`, toolbars and panels on the stage (1.4:1 against stage-bg, so edges get a `--stage-border` line)
- `--stage-border`: `#669BBC` (3.2:1 on raised)
- `--stage-text`: `#FDF0D5` (12.3:1 on stage-bg, 8.6:1 on raised)
- `--stage-text-muted`: `#B1B6AB` (6.7:1 on stage-bg, 4.7:1 on raised), also stage input placeholders
- `--stage-accent`: `#669BBC` (Steel Blue), kept segments, selection (4.6:1 on stage-bg, 3.2:1 on raised); never text on raised
- `--stage-focus`: `#FDF0D5`, 2 px ring with 2 px offset; the `Stage` container sets it so every component inside inherits it
- `--stage-hover`: `#FDF0D5` at 10% over the current stage surface
- Primary buttons on the stage: Steel Blue fill with a Deep Space Blue label (4.6:1); hover and pressed mix the Steel Blue towards cream (`color-mix`, which only raises the label's contrast); disabled controls on the stage use cream tints (exempt from contrast, still labelled)
- Playhead: 3 px `--stage-text` line with a 1 px `--stage-bg` outline and a round handle (so it shows over kept segments)
- Removed cuts: Brick Red fill with diagonal stripes and a 1 px `--stage-text` outline, never colour alone
- Letterbox around videos that aren't 16:9: `--stage-bg`

Colour rules:

- Steel Blue is never text or an icon on the light app (2.7:1, fails); stage only.
- Brick Red is never text or a focus ring on the stage (2.2:1, fails).
- Status is never colour alone: always an icon plus a label.
- Links in running text are underlined (2 px offset), because red alone isn't distinguishable from blue body text.

## Type

- UI, headings and transcript: **Inter**; timestamps, durations and file sizes: **JetBrains Mono** with `font-variant-numeric: tabular-nums` (class `.mono`)
- Fonts load with `next/font/google` (downloaded at build time and self hosted, works under OpenNext), latin subset, variable axis only, `display: swap`; JetBrains Mono with `preload: false`
- Scale (rem, line height): display 2.5/1.1 (landing only), h1 2/1.2, h2 1.5/1.25, h3 1.25/1.3, body 1/1.5, small 0.875/1.45, caption 0.75/1.4
- Transcript text: body size, 1.7 line height, max 72 characters per line
- Minimum text size 0.75 rem for anything a creator must read

## Shape, spacing and layout

- Spacing scale: 4 px base (4, 8, 12, 16, 24, 32, 48, 64)
- Corner radius: 10 px on cards, buttons, inputs and dialogs; 6 px on chips and timeline segments; full round on avatars and icon buttons
- Elevation: one soft shadow for cards, a stronger one for menus, dialogs and toasts
- Breakpoints: sm 640, md 768, lg 1024, xl 1280
- Desktop (md and up): left sidebar 240 px (active item: `--selected-surface` plus left bar), user menu with sign out at the bottom; content max width 1200 px, 24 px gutter
- Phones (below md): top bar with the menu in a left sheet; 16 px gutter
- Every page starts with a "Skip to content" link and uses landmarks (`header`, `nav`, `main`)
- Layers (z-index): base 0, sticky 10, stage overlay 20, dropdown 30, dialog backdrop 40, dialog 50, toast 60, tooltip 70
- Motion: 150 to 200 ms ease out; respect `prefers-reduced-motion` (skeletons become static, no slide ins)
- Scrollbars: native and thin, `--border-strong` on light and `--stage-text-muted` at 40% on stage; `scrollbar-gutter: stable` and `overscroll-behavior: contain` in scrolling panels

## Touch and targets

- Controls are at least 24 px on desktop and at least 44 px on touch (`pointer: coarse`); icon buttons are 40 px on desktop
- Nothing depends on hover; every hover action is also reachable by tap or keyboard
- Timeline cut segments render at least 12 px wide however short the cut, with a tooltip giving the exact length

## Icons

- Lucide, imported per icon (`lucide-react`), stroke 1.5 set once in a shared `Icon` wrapper
- Sizes: 16 in badges and inputs, 20 in UI, 24 for stage controls, 40 for empty state illustrations
- Icons inherit `currentColor`; icon only buttons always have an accessible name

## Components

Built with Tailwind CSS v4 (CSS first `@theme` in `globals.css`, `@tailwindcss/postcss`, no `tailwind.config.js`) and shadcn/ui (style new-york, `cssVariables: true`, Lucide), pinned versions. shadcn's variables (`--background`, `--foreground`, `--primary`, `--ring`, `--destructive` and so on) map to the tokens above so copied components work unchanged.

Base components: Button (primary, secondary, ghost, destructive, link; sizes sm, md, lg; states default, hover, pressed, focus, disabled, loading), Input, Textarea, Select, Checkbox, Switch, Slider, Dialog, Sheet, Dropdown menu, Tooltip, Toast, Alert, Tabs, Card, Badge, Progress, Skeleton, Avatar.

- **Inputs**: label always visible above (never placeholder only); helper text below in `--text-muted`; error state has a `--danger` border, an error icon and message below linked with `aria-describedby`; required fields marked "(required)" in text; read only looks like plain text in a box
- **Toasts**: bottom right on desktop, bottom centre on phones; variants default, success, error, info, each with icon and label; success and info dismiss after about 5 seconds and pause on hover or focus (`role="status"`); errors stay until dismissed (`role="alert"`)
- **Alerts**: inline, tinted background (`--danger-bg`, `--success-bg`, `--warning-bg`, `--info-bg`) with icon, title and text in `--text`
- **Dialogs**: sizes sm 400, md 560, lg 720 px; body scrolls, header and actions stay fixed; on phones dialogs become bottom sheets; destructive confirm states exactly what is removed ("Deletes the video, cuts and transcript of 'My take'") with a destructive button and a cancel
- **Progress**: fill `--info` (5.4:1 on bg) on a decorative `--border` track; indeterminate state for unknown duration; on the stage, fill `--stage-accent` on `--stage-raised`
- **Skeletons**: light version `--disabled-bg` shimmer; stage version `--stage-raised` shimmer on `--stage-bg`; static under reduced motion

Product components (built in their slices, styled per this file):

- **Upload dropzone**: large dashed `--border-strong` area on `--surface`, icon, one primary "Choose a video" button, the limits written underneath (MP4 or MOV, up to 10 minutes, 2 GB, 1080p); drag over state uses a `--primary` border
- **Processing progress**: one row per step (trim, transcript, background, AI edit, render) with icon, label, status text and a Progress bar; overall progress on top; announced with `aria-live="polite"`
- **Take card and list**: 16:9 thumbnail, title, duration (mono), status badge (icon plus label), expiry note ("Video expires in 12 days"); newest first
- **Video player (stage)**: 16:9 with letterbox, poster image while loading, custom controls with keyboard shortcuts (space play or pause, arrows seek, J K L), time in mono
- **Cut timeline (stage)**: kept segments `--stage-accent`, removed cuts striped Brick Red with outline, playhead as above; each cut is a focusable button labelled like "Pause, 1.2 seconds, removed, proposed by AI: dead air"; Enter or tap toggles it with an Undo toast
- **Transcript panel**: light panel beside the stage on desktop, below it on phones; one mono `m:ss` button per paragraph (the keyboard stop), words that seek on a click, filler words underlined dotted, the playing paragraph marked with `aria-current`; removed words are not shown until slice 4 (then struck through and muted). The player has a CC button (off by default, `aria-pressed`) and uses the take's thumbnail as its poster
- **Background picker**: grid of 16:9 thumbnails, built ins first then the creator's uploads; selected item has a 2 px Brick Red ring with a 2 px white inner gap plus a check badge on a solid chip
- **Background section (take page)**: under the player, "Background" with a line for what the video is on now, the notes (kept on its own background when no green screen was found; a preview that found none; progress while a new video is made, with the old one still playable; why a change failed), the same grid as the dialog (Keep original, Studios, Your backgrounds with the Upload image tile, Delete on your own), a preview of the take on the chosen background shown over the stage with a "Preview, not your video yet" chip, one action (Use this background, or Keep original when that is chosen, or Try again after a failure, repeating the failed target) and the "Getting clean edges" tip. The current and the chosen background stay visible when the list cannot load.
- **Background select (upload area)**: a compact secondary button showing the current pick's 16:9 thumbnail, a small "Background" label and its name ("Keep original" by default); it opens the picker as a dialog (a bottom sheet on phones) with "Keep original" first, then "Studios", then "Your backgrounds"; the tiles are one radio group (arrows move, Space selects, a choice applies at once, Done closes) and focus returns to the select
- **Phones (review screen)**: player full width at the top; Transcript and Cuts in tabs below; the timeline scrolls sideways with a zoom slider; tapping a cut opens a bottom sheet with its details and Keep or Remove

## Screen states

- **Empty**: icon (40 px), one sentence, one primary action (for example "No takes yet. Upload your first video.")
- **Loading**: skeletons shaped like the content, never a lone spinner for whole pages
- **Error**: friendly message saying what happened and what to do, a Retry button, never raw error codes; app level `error` and `not-found` pages in the same style
- **Expired video**: take stays visible with "Video expired on 3 Dec", transcript and cuts readable, download and re render hidden
- **Upload rejected**: inline alert naming the limit that was hit ("This video is 14 minutes long. The limit is 10 minutes.")

## Voice

- Friendly, plain and short; speak to the creator as "you"
- Sentence case everywhere (buttons, titles, menus)
- Errors say what happened, then what to do next
- Buttons are verbs: "Choose a video", "Render", "Download", "Retry", "Delete take"
- Times in mm:ss (h:mm:ss over an hour) in mono; durations like "12 days", "1.2 seconds"; dates like "3 Dec"

## Accessibility (WCAG AA, team rule)

- Every text colour pair meets 4.5:1 (3:1 for large text and UI graphics); the pairs above are checked
- Everything works by keyboard with a visible focus ring (Brick Red on light, cream on the stage); dialogs trap focus and restore it on close
- Semantic HTML first; headings in order; icon only buttons have labels
- Status and progress updates are announced politely (`aria-live`); errors use `role="alert"`
- Videos offer captions once transcripts exist (slice 2)
- Automated axe checks run in the Playwright tests

## Performance

- Keep `"use client"` on leaf components only; the shell, pages and layout stay server components
- Import icons one by one; the `/design` gallery and stage components never load in shared layouts
- Images are `unoptimized` (spec 0001), so thumbnails and backdrops are pre sized at 320, 640 and 1920 px

## Assets

- Built in studio backgrounds: about six generated 1920×1080 backdrops matched to the palette (warm podcast studio, bright minimal studio, bookshelf office, soft palette gradient, dark stage with rim light, plant corner), each approved by Toyin before shipping (slice 3), with alt text
- Landing page imagery: product screenshots of the real app plus one generated hero image

## Component gallery

`/design` shows every base component in every state on both light and stage. It exists only in development and preview builds (never on the live site), is `noindex`, and is used as PR proof and for the axe check.

## References (Mobbin)

Direction (light app, dark stage):

- Vimeo editor: https://mobbin.com/screens/bd482934-e96c-4560-967f-2509d3c341d8
- Arcade editor: https://mobbin.com/screens/9cf2acbc-d086-417c-84a5-ea4e7b5168f1
- VEED subtitles editor: https://mobbin.com/screens/23d2e62a-6d7f-4fe0-a7a9-a337197f2a95
- Synthesia video library: https://mobbin.com/screens/ccdde91d-406f-4c85-9dd9-9e1eb04a4d3e

Transcript editing and timeline:

- Descript editor: https://mobbin.com/screens/1ae458fa-9187-422e-b1df-06b5290ce048
- Riverside editor: https://mobbin.com/screens/87a6a423-36e8-48c1-9ffd-32df1b6c4c69

Upload and library:

- Fireflies upload: https://mobbin.com/screens/0e45d455-f884-44a9-8600-16830793250e
- Grain upload: https://mobbin.com/screens/118d436d-69cd-4729-a843-fef4150a5ffc
- Fiverr video upload with requirements: https://mobbin.com/screens/d0fda4fd-b04e-4a1c-9f4f-1c6d4516d267
- Loom video library: https://mobbin.com/screens/9e8909a2-43b5-4007-b72d-05475a8c0af4

Processing state:

- Synthesia transcribing progress: https://mobbin.com/screens/c87e9578-a8d1-4f44-b08d-4f2839f1df3e

Transcript panel beside the player (spec 0007, S2T-T05):

- Mistral AI speech to text, paragraphs with a play icon and mono timestamp: https://mobbin.com/screens/93863599-531f-447f-abde-03af324bb7bd
- Descript script editor, dotted underlined filler words: https://mobbin.com/screens/6bf488ec-ca2f-47c2-a2fd-e906ba560a56
- Canva course page, transcript under the player: https://mobbin.com/screens/d85366a6-602e-42ca-a84e-98a9ab23b9d8
- Canva captions on video: https://mobbin.com/screens/c83042ea-10aa-4cdf-a671-e7c47b5258d0
- Descript export dialog: https://mobbin.com/screens/1a19201c-754b-4a17-982b-e02c98c89998

Background picker (spec 0008, S3S-T02):

- Fresha "Package theme" dialog, 16:9 tiles with the selected one ringed: https://mobbin.com/screens/a66f8e0f-c48e-4db4-9a05-178bd819e4ce
- Canva "Select an image", the creator's uploads in a grid: https://mobbin.com/screens/80abfe1e-3228-4a9a-8169-30058bcb5c3b
- Base44 "Select an image", check badge on the selected tile: https://mobbin.com/screens/4c04aa14-c320-4db1-ba4b-18e4ad7e8436
- Meetup "Choose from existing", a small dialog that works on phones: https://mobbin.com/screens/33a075cc-1fa8-4261-b0c1-6922c72af20a
- Gumloop gallery, groups with headings: https://mobbin.com/screens/8bacc083-81f8-4518-a615-99c3e89da65f
- WeTransfer "Customize background", picker beside a live preview: https://mobbin.com/screens/2bb9e7f1-d420-4500-b0e5-e3e671b6ce4b
- Wix "Replace Background", the compact current pick: https://mobbin.com/screens/11fae0cb-4390-4d53-8182-c48ed449d733

Background picker on the take page (spec 0008, S3S-T06):

- Canva Background Generator, the chosen result ringed beside a large preview of the person on the new background: https://mobbin.com/screens/c10c7460-7b4d-4884-9019-eb9cf8d3ae0d
- WeTransfer "Customize background", picker beside a preview with Apply: https://mobbin.com/screens/f0286cb9-f03a-4d26-8287-64df47ed3eec
- SoundCloud "Saving", processing status while the track stays usable: https://mobbin.com/screens/f621f713-633a-4984-a381-0f387b072da7
- Plus the picker references above (Fresha, Canva uploads, Base44, Meetup, Gumloop, Wix).
