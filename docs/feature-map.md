# Feature map

Every page and user-facing feature, by the name Toyin uses, with its route, who can reach it and how to get there. Use these names in specs, proof and messages, and drive agent-browser from this list (see ROLE.md, Teamwork). A PR that adds, renames, moves or removes a page or feature, or changes who can reach it or how, updates this file.

Signed in pages need a session. In e2e tests and local agent-browser runs, sign in with the test helper in `tests/support/session.ts` (seeds a user and sets the session cookie against the local Postgres); never use a real account.

## Public pages

| Feature | Route | How to get there | Spec |
| --- | --- | --- | --- |
| Homepage (landing page) | `/` | Open the site signed out. Signed in visits go to the library. | 0010 |
| Sign in (email link) | `/sign-in` | "Sign in" on the homepage, or any signed in page while signed out. | 0006 |
| Link expired | `/sign-in/link-expired` | Open an old or used sign in link. | 0006 |
| Privacy | `/privacy` | Footer, or Account menu > Privacy. | 0015 |
| Terms | `/terms` | Footer, or Account menu > Terms. | 0015 |
| API docs | `/docs/api` (JSON at `/api/openapi.json`) | Homepage links, or direct. | 0018 |
| MCP docs | `/docs/mcp` | Homepage links, or direct. | 0019 |
| Email opt out | `/emails/off/confirm`, then `/emails/off/done` | The link in a "take is ready" email. | 0006 |

## Signed in pages

| Feature | Route | How to get there | Spec |
| --- | --- | --- | --- |
| Library (your takes) | `/library` | Sign in, or the brand link in the header. | 0004, 0013 |
| Upload a take | `/library`, upload area | "Choose a video" in the upload area, with the background select beside it. | 0004, 0008 |
| Monthly usage meter | `/library`, upload area | Shown in the upload area while the monthly limit is enforced. | 0014 |
| Delete a take | `/library` or `/takes/[id]` | The take's delete action in the library, or "More actions for this take" on the take page. | 0013 |
| Record with script (teleprompter) | `/record` | "Record" button in the upload area. "Use this take" uploads it and opens the take page. | 0021 |
| Take page | `/takes/[id]` | Click a take in the library. Shows the player, the cut timeline and the "Take tools" tabs. | 0004 |
| Player and full screen | `/takes/[id]` | Player controls under the video ("Full screen"). | 0004 |
| Cut review timeline | `/takes/[id]` | The timeline under the player: turn cuts on or off, then save a new render. | 0011, 0020 |
| AI edit | `/takes/[id]` | Cuts suggested by the AI edit step show in the cut timeline. | 0012 |
| Mark a missed pause | `/takes/[id]` | The "missed" button on the timeline. | 0017 |
| Export (downloads) | `/takes/[id]`, Take tools > Export | "Save edited video", "Save original video". | 0004 |
| Studio background | `/takes/[id]`, Take tools > Background | Pick a studio or your own background, preview it, then apply. | 0008 |
| Transcript | `/takes/[id]`, Take tools > Transcript | Read the transcript, "Save transcript (TXT)", "Save captions (SRT)". | 0007 |
| Take details and rename | `/takes/[id]` | "Rename" beside the take's title; Take tools > Details for length, dates and expiry. | 0004, 0013 |
| API keys | `/account/api-keys` | Account menu > API keys. | 0018 |
| Connected apps (OAuth) | `/account/api-keys` | Listed on the API keys page. | 0019 |
| App sign in consent | `/oauth/consent` | Reached from an MCP client's sign in flow. | 0019 |
| Insights (product analytics) | `/insights` | Direct only; the insights viewer account only, everyone else gets not found. | 0016 |

## Not for creators

| Feature | Route | Notes |
| --- | --- | --- |
| Design gallery | `/design`, `/design/error` | Dev and preview only (returns not found in production). |
| Health check | `/api/health` | 503 when a check fails. |
| Public API | `/api/...` (the routes in `/api/openapi.json`) | By API key; documented at `/docs/api`. |
| MCP server | `/mcp` | By API key or OAuth token; see `/docs/mcp`. |
