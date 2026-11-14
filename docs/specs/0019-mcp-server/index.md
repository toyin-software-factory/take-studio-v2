# 0019. MCP server for AI agents

**Date**: 2026-11-14
**Status**: Proposed

## Summary

An AI assistant (Claude, ChatGPT, Cursor and agent tools) connects to Take Studio at one address, `/mcp`, and works on a creator's behalf: start an upload, run it, review the cuts, fetch the transcript and the video, change a background, delete a take. The server is a thin layer over the public API of spec 0018: each tool calls the same route code with the creator's own credential, so the limits, the ownership rules and the monthly allowance are the web app's, not a copy. It ships in two steps: first a creator's API key as the credential (works in developer tools today), then a sign in and consent flow (OAuth) so Claude.ai and ChatGPT connectors work without pasting a key.

## Requirements

**User stories**:
- As a creator, I want to tell my AI assistant "upload this, cut the filler, give me the video and the transcript" and have it done in my account.
- As a creator, I want to connect an assistant by signing in and approving it, see which assistants are connected, and disconnect one at once.
- As a developer, I want to point an MCP client at one URL with my API key.
- As the product owner, I want an assistant bound by the same limits and permissions as the web app, and a key or token that reaches only its creator's takes.

**Acceptance criteria**:
- **AC-1**: Endpoint and transport. `POST /mcp` speaks MCP over Streamable HTTP in stateless mode: each request is one JSON-RPC message answered with one JSON body (no stream, no session id kept). It handles `initialize` (protocol version negotiated, server name and a short instructions text), `notifications/initialized` (202), `ping`, `tools/list` and `tools/call`; any other method is `-32601`. `GET /mcp` and `DELETE /mcp` answer 405. A JSON array (batch) or a body over 256 KB is rejected (`-32600`, 413). `force-dynamic`, no caching.
- **AC-2**: Same identity as the API. `/mcp` needs `Authorization: Bearer`. The bearer is resolved by spec 0018's `resolveCreator` (an API key `tsk_...`, and after the OAuth step an access token), with no cookie fallback. Missing or bad credentials answer 401 with `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource"` so a client can discover how to sign in. Origin is not used (no ambient credential).
- **AC-3**: Tools are the API, not a copy. Each tool maps to one registry route (0018) flagged as an MCP tool, and calling it builds an internal `Request` for that route (same method, path, JSON body, the caller's own `Authorization` header) and calls the route's exported handler in the Worker, with no network hop. So the guard, the ownership query, the monthly allowance (`limit_exceeded`), the hourly limits, retention and every error code are the route's own. Tool code contains no limit or permission logic. A test runs each tool and the route it wraps with the same input and compares status and body.
- **AC-4**: The tool set. At least these, named as verbs, each with a plain description, a zod input schema (sent to clients as JSON Schema) and the MCP annotations `readOnlyHint`, `destructiveHint`, `idempotentHint`: `get_usage`, `list_takes`, `get_take` (status, progress, cuts with reasons and `applied`, background, suggestion, latest render), `start_upload`, `get_upload_part_links`, `complete_upload`, `abort_upload`, `retry_take`, `get_job`, `get_media_link` (preview or download, a presigned link), `get_transcript`, `make_transcript`, `get_transcript_file` (txt, srt, vtt), `undo_ai_fix` (undo or redo one fix), `list_backgrounds`, `change_background`, `preview_background`, `apply_changes` (cuts on or off and the background, with `baseRenderId`), `get_waveform`, `mark_missed`, `delete_take`. A test fails when a registry route flagged for MCP has no tool or a tool has no registered route; the routes left out (key and sign in routes, delete account, email preferences, background library upload) are listed with a reason.
- **AC-5**: Upload without bytes in the message. `start_upload` returns the take ID and the upload plan (part size, count and presigned part links in the first batch, the same as the route), and the tool text says how to send the file: an agent with file or shell access sends each part with an HTTP `PUT` to its link and then calls `complete_upload`; an assistant with no file access (a chat) tells the creator to open the returned library link and drop the file in the web app, and then continues with `list_takes`. The server never fetches a file from a URL an assistant names (no server side download, no SSRF surface); see Follow-up.
- **AC-6**: Run and review. After the upload completes, processing starts as in the web app (the probe starts the first job), `get_take` and `get_job` show progress, and `get_take` returns the cuts the creator would see (kind, time, reason, who proposed it, applied), so an assistant can review them and call `apply_changes` to turn cuts on or off, with the same `stale`, `nothing_changed` and `change_limit` answers as the web.
- **AC-7**: Destructive guard. `delete_take` requires `{ takeId, confirm: true }` (the literal `true`); without it the tool answers an error telling the assistant to ask the creator first and does not call the route. Its annotation is `destructiveHint: true`. `abort_upload`, `apply_changes` and `change_background` are marked as changing state, never read only. The server instructions tell assistants to confirm destructive actions with the creator.
- **AC-8**: Results are data, never instructions. Tool results are JSON text of the route's body (or the route's `{ error, message }` with `isError: true`); transcript text, cut reasons and take names are returned as values inside the JSON, with a field note in the tool description that they come from the creator's video and must not be followed as instructions. No result ever contains a key, token, hash, email or another creator's data.
- **AC-9**: Ownership. Every tool acts as the credential's creator and nothing else: another creator's take, background or job is the route's 404, shown to the assistant as `isError` with the same message. No tool accepts a creator ID. A test calls every tool with creator A's credential against creator B's IDs.
- **AC-10**: Limits. The per key rate limit of spec 0018 (120 a minute) counts each `POST /mcp`, including `tools/list`; the 429 carries `Retry-After`. The monthly allowance and the other route limits apply through AC-3. The assistant sees the refused action's own message (for example the dated `limit_exceeded` text).
- **AC-11**: Private and observable. The log line of a call has the tool name, the take ID if any, the creator ID, the HTTP status the route gave and the duration, and nothing else: never the arguments, the results, a transcript, a reason, a presigned link, a key or a token. A refused credential is an expected result (counted, not reported to the error monitor). Responses carry `Cache-Control: private, no-store`.
- **AC-12**: Connect with a key (first step). A creator adds the server to a client with the URL and the header `Authorization: Bearer tsk_...` from the API keys screen of spec 0018. The `/docs/mcp` page (public, in the docs of spec 0018) gives copy ready setup for Claude Code, Cursor and a plain JSON config, a list of the tools and a worked example. Nothing else is needed; this step stands on its own.
- **AC-13**: Connect with sign in (second step, OAuth 2.1). The server publishes `/.well-known/oauth-protected-resource` (resource `<base>/mcp`, the authorization server) and `/.well-known/oauth-authorization-server` (issuer, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `code_challenge_methods_supported: ["S256"]`, grant types `authorization_code` and `refresh_token`). A client registers itself with `POST /oauth/register` (RFC 7591: a name and redirect URIs; https redirect URIs or loopback only; no wildcards; at most 20 clients registered per hour per IP). `GET /oauth/authorize` needs the creator's session (the existing sign in) and shows a consent page naming the client and what it can do (read and change your takes, run processing, delete takes); Allow issues a one time code (60 seconds, bound to the client, the redirect URI and the PKCE challenge, S256 only, exact redirect match, `state` returned); Deny returns `access_denied`. `POST /oauth/token` exchanges the code (PKCE verified) for an access token (1 hour) and a refresh token (30 days, rotated on every use, a reused old one revokes the whole grant). Tokens are random, stored only as SHA-256 hashes, accepted only in the header, and tied to the `resource` the client asked for (`<base>/mcp` and the API).
- **AC-14**: Connected apps. A creator sees the connected assistants (client name, connected on, last used) next to the API keys of spec 0018 and disconnects one with a confirm; disconnect deletes the grant and its tokens and works on the next request. An OAuth access token reaches the same routes as the creator's session, except the session only routes (key management, connected apps, delete account), which answer 401 `session_required` (the rule of 0018 AC-4 extends to tokens). Deleting the account deletes its grants (foreign key `ON DELETE CASCADE`, tested through the real delete path).
- **AC-15**: Accessible consent and screens. The consent page and the connected apps list work by keyboard, have visible focus, AA contrast, 44 px targets, an accessible name for every control, a polite status message and hold at phone width; Allow and Deny are plain buttons, the client name is shown as text (never as markup or a link) with the redirect host beside it.
- **AC-16**: Legal facts. The build PR adds to `COLLECTED` in `src/lib/legal-facts.ts` the connected app records (client name, redirect hosts, the creator it belongs to, created and last used times, kept until disconnect or account deletion), records the new runtime dependency (the MCP SDK, if used, in `NON_DATA_PACKAGES`), adds to the Privacy copy that an assistant a creator connects can read their takes' transcripts, cut reasons and video links under that assistant's own terms and policy (we send it only what it asks for through the creator's own credential), adds to the Terms that actions taken through an assistant are the creator's, bumps `LEGAL_VERSION` to the real date and appends a line to `legal-text-hashes.ts`. No new processor of ours, cookie or env secret (the OAuth tokens need no secret since they are hashed random values). `pnpm legal:drift` clean.
- **AC-17**: Compatibility is checked for real. Before this is called done, the server is connected from the MCP Inspector and from at least one real client by key (Claude Code), and, for the OAuth step, from Claude.ai as a custom connector, and each runs a full upload (by presigned link), run, review cuts, fetch transcript and video link, delete cycle on a real take. Agents cannot reach Claude.ai, so this live check is a step for Toyin through Michael, recorded in the review file.

## Decision

**Chosen option**: Option 1: Thin tools over the API, key first then OAuth.

Transport: the official MCP TypeScript SDK's web standard Streamable HTTP transport in stateless mode, if it builds and runs on the Worker in the first build task; the runner up is a hand written JSON-RPC handler for the five methods (about 200 lines, no dependency), used if the SDK does not fit the Worker or the bundle. OAuth: Better Auth's own OAuth provider package if it passes a short spike (Workers, hashed tokens, S256 only, rotating refresh); the runner up is a minimal own implementation of the four endpoints. Both are decided by the spike in the build plan and recorded in this spec's Follow-up.

**Implementation skills**: `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`) · `better-auth-security-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-security-best-practices/`) · `workers-best-practices` (`cloudflare/skills`, `.claude/skills/workers-best-practices/`) · `nextjs-on-cloudflare` (`cloudflare/skills`, `.claude/skills/nextjs-on-cloudflare/`)

## Feature design

**Data model sketch** (the first step adds none; spec 0018's `api_key` and `api_rate_window` are used as they are):

`oauth_client` (second step)
| Field | Type | Notes |
|---|---|---|
| `id` | text pk | the `client_id`, random |
| `name` | text not null | 1 to 80, shown as text only |
| `redirect_uris` | text[] not null | https or loopback, exact match |
| `created_at` | timestamptz not null | |
| `registered_ip_hash` | none | not stored; the hourly registration limit uses the existing database rate limit table |

`oauth_grant`
| Field | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `creator_id` | text not null, FK `user.id` ON DELETE CASCADE | indexed |
| `client_id` | text not null, FK `oauth_client.id` ON DELETE CASCADE | unique with `creator_id` (one grant per creator and client) |
| `created_at`, `last_used_at` | timestamptz | `last_used_at` set at most hourly |

`oauth_token`
| Field | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `grant_id` | uuid not null, FK `oauth_grant.id` ON DELETE CASCADE | |
| `kind` | `access` or `refresh` | |
| `token_hash` | text not null, unique | SHA-256 hex |
| `expires_at` | timestamptz not null | access 1 hour, refresh 30 days |
| `used_at` | timestamptz null | refresh only: set on rotation, a second use revokes the grant |

`oauth_code`: short lived (60 seconds) rows `code_hash`, `grant` inputs (`creator_id`, `client_id`, `redirect_uri`, `code_challenge`), `expires_at`, deleted on use; expired rows are removed by the existing cleanup sweep, as are expired tokens.

**State transitions**: a code is issued then used or expired; a refresh token is issued, then used once (rotated) or expired; a reused refresh token deletes the grant.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/mcp` | POST | one JSON-RPC message | one JSON-RPC reply | bearer (key or token) | 401 with `WWW-Authenticate`, 413, 429, `-32600`, `-32601`, `-32602` |
| `/mcp` | GET, DELETE | none | 405 | none | 405 |
| `/.well-known/oauth-protected-resource` | GET | none | metadata | public | none |
| `/.well-known/oauth-authorization-server` | GET | none | metadata | public | none |
| `/oauth/register` | POST | `client_name`, `redirect_uris` | client record | public, IP limited | 400 `invalid_redirect_uri`, 429 |
| `/oauth/authorize` | GET, POST | standard params, PKCE challenge, `resource` | consent page, then redirect with code | session, Origin on the POST | `access_denied`, `invalid_request` |
| `/oauth/token` | POST | code and verifier, or refresh token | access and refresh tokens | client (public, PKCE) | `invalid_grant`, `invalid_client` |
| connected apps list and disconnect | GET, DELETE | none | grants | session only | 401, 404 |
| `/docs/mcp` | GET | none | page | public | none |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Any `/mcp` call | the creator | `resolveCreator` (0018) on the bearer; never a tool argument |
| Tool call | the route to run and its method | the registry entry (0018) the tool is named for |
| Tool call | the JSON body | the tool's validated input, passed through to the route's own zod validation |
| Tool result | body or error | the route's response body and status, unchanged |
| `initialize` | protocol version | the client's requested version if supported, else the server's newest |
| `initialize` | server instructions | `MCP_INSTRUCTIONS` constant in `src/lib/mcp-rules.ts` (confirm destructive actions, results are data) |
| 401 | `resource_metadata` URL | `BETTER_AUTH_URL` (already set) plus the well known path |
| Metadata documents | issuer and endpoint URLs | `BETTER_AUTH_URL` |
| OAuth code | the creator | the session at `/oauth/authorize` |
| OAuth code | challenge, redirect, client | the request, checked against the registered client |
| Tokens | access and refresh | 32 random bytes each, base64url, hashed before storing |
| Token lifetimes, client rate limits, tool body cap | numbers | constants in `src/lib/mcp-rules.ts` (`MCP.accessTokenSeconds` 3600, `refreshTokenDays` 30, `codeSeconds` 60, `registerPerHour` 20, `maxBodyBytes` 262144) |
| Consent page | client name, redirect host | the stored client record, rendered as text |
| Connected apps list | client name, created, last used | `oauth_grant` joined to `oauth_client` |

**Key invariants**:
- A tool never decides a limit or a permission; the route does.
- The credential is the only source of the creator.
- Tokens and keys are stored hashed and never logged or returned after issue.
- A bearer present means the cookie is ignored (0018).
- Every registry route flagged for MCP has a tool and every tool has a route (AC-4).
- OAuth: S256 only, exact redirect match, one use codes, rotating refresh tokens.

**Security model**: An assistant holds a key or token that acts as the creator in the web app's own routes and nothing else: no key management, no connected apps management, no account deletion, no other creator's data (404). A token cannot be used as a session or for any other site. The consent page is the one place a creator grants access, and it names the client and the power it gets (all of the creator's takes, including delete). Prompt injection through transcript text is limited by the data note, the `confirm: true` delete guard and the destructive annotations; assistants still need to ask the creator, which the server instructions say. No CORS headers on `/mcp` (hosted connectors call from their servers); discovery and token endpoints are plain HTTPS, with CORS on the discovery and token endpoints only if a browser client needs it (Follow-up). Compliance scope: connected app records are personal data tied to an account (AC-16).

**Configuration required**: none new. The base URL is `BETTER_AUTH_URL`; tokens are hashed random values with no signing secret.

**Critical test scenarios**:
- Happy path: with a key, `initialize`, `tools/list`, `start_upload`, PUT a part, `complete_upload`, `get_take` until ready, `get_media_link`, `get_transcript`, verifies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-6**
- Parity: each tool and its route return the same status and body for the same input, verifies **AC-3**
- Auth/permission: creator A's key against creator B's take, background and job through every tool is the route's 404, verifies **AC-9**
- Failure case: no or wrong bearer is 401 with the `WWW-Authenticate` metadata link; a revoked key stops on the next call, verifies **AC-2**
- Failure case: `delete_take` without `confirm: true` does not call the route and the take survives, verifies **AC-7**
- Failure case: the 121st call in a minute is 429 with `Retry-After`; the allowance refusal shows the dated message, verifies **AC-10**
- Failure case: a batch, an oversized body and an unknown method are refused with the right codes, verifies **AC-1**
- Privacy: the log line for a call holds only tool, IDs, status and duration; the key, link and transcript never appear, verifies **AC-11**
- Coverage: a flagged route without a tool, or a tool without a route, fails the test, verifies **AC-4**
- OAuth: registration with a bad redirect, a wrong verifier, a replayed code, a reused refresh token (grant revoked), an access token past an hour, and S256 only are all refused, verifies **AC-13**
- OAuth permission: a token on a session only route is 401 `session_required`; disconnect works on the next call; account deletion removes grants, verifies **AC-14**
- Browser: consent and connected apps by keyboard, axe clean, phone width, verifies **AC-15**
- Real clients: Inspector, Claude Code, Claude.ai run the full cycle, verifies **AC-17**

## Build plan

Approach: Tracer Bullet. First a key through `/mcp` for two tools end to end, then every tool, then the docs, then OAuth as its own slice.

1. Spike (small, recorded in Follow-up): does the MCP SDK's web standard stateless transport build and run on the Worker with OpenNext; fall back to the hand written handler if not. Rules file `src/lib/mcp-rules.ts` (constants, instructions, tool name list), satisfies **AC-1**
2. Tracer thread: `POST /mcp` with `initialize`, `tools/list`, `tools/call`, key auth through `resolveCreator`, the internal dispatch (`src/server/mcp/dispatch.ts`) and two tools (`get_usage`, `list_takes`), the 401 header, size and batch limits, live check by key, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-10**, **AC-11**
3. Every tool over the registry (flag in the registry, input schemas from the routes' zod schemas, annotations), the delete guard, the parity, ownership and coverage tests, satisfies **AC-3**, **AC-4**, **AC-7**, **AC-8**, **AC-9**
4. Upload and run by presigned links: `start_upload` text and web link fallback, a script that does upload, run, review, fetch and delete through `/mcp` only on a real take, satisfies **AC-5**, **AC-6**
5. `/docs/mcp` with setup for Claude Code, Cursor and plain JSON, the tool list generated from the registry, satisfies **AC-12**
6. OAuth spike: Better Auth's OAuth provider package against the four rules (Workers, hashed tokens, S256 only, rotating refresh) or a minimal own implementation; record the choice, satisfies **AC-13**
7. OAuth data and endpoints: migration (`oauth_client`, `oauth_grant`, `oauth_token`, `oauth_code`), metadata, register, authorize, token, refresh rotation, `resolveCreator` accepting tokens, cleanup of expired rows, satisfies **AC-13**, **AC-14**
8. Consent page and connected apps list beside API keys (needs Mobbin references, design check), browser tests and axe, satisfies **AC-14**, **AC-15**
9. Legal facts, Privacy and Terms copy, version and hash line, `pnpm legal:drift` clean, satisfies **AC-16**
10. Live compatibility check: Inspector and Claude Code by key, Claude.ai by OAuth (Toyin through Michael), review file, satisfies **AC-17**

Steps 1 to 5 and 9 (for the dependency and tools lines) are shippable on their own as the key based server; steps 6 to 8 and 10 add OAuth.

## Consequences

**Positive**:
- Assistants get everything the web app can do, with the same protections and one rulebook.
- Developer tools work after step 5; hosted connectors after step 8.
- The registry, the parity test and the coverage test keep tools and routes from drifting.

**Negative / tradeoffs**:
- OAuth adds a security sensitive area and a new stored area (clients, grants, tokens) to run and review.
- Assistants read creators' transcripts and cut reasons, which are untrusted text in a third party's context; the guard (data note, delete confirm, destructive hints) lowers the risk and does not remove it, and the creator carries the choice of assistant.
- Route handlers gain a second caller; changing their exports needs the parity test to pass.
- A leaked key or token can read and delete the creator's takes until revoked (mitigations: allowance, rate limit, instant revoke, short lived access tokens, rotating refresh).

**Neutral**:
- New stored personal fields (connected apps) in step two; a possible new runtime dependency (the MCP SDK and, if chosen, the OAuth package) to record in the legal registry.
- No new processor, cookie or env secret.

## Follow-up

- [x] Decided (Toyin, via Michael, 2026-11-14): she approved the recommended pick of all three questions, 1A, 2A and 3A, as listed here. The questions were: (1) which assistants first: developer tools by key first, then Claude.ai and ChatGPT connectors by sign in (recommended) or the sign in flow first; (2) the assistant may delete a take, only with an explicit confirm from the assistant after it asked you (recommended) or no delete tool at all; (3) uploading: presigned links for assistants that can send files, and a link to the web app for chat only assistants (recommended) or also let the server download a file from a URL the assistant gives (more work, cost and abuse risk, later).
- [ ] Record the step 1 and step 6 spike results here (SDK on the Worker or hand written; OAuth package or own).
- [ ] Optional later: server side upload from a URL with strict rules (https only, no private addresses, a size cap and the monthly allowance); read only keys and tokens (a `scope` column, shared with spec 0018's follow up); MCP resources and prompts; CORS for browser clients; per assistant analytics events (needs a new event, a legal facts line and Toyin's say); listing in a connector directory (marketing, C-24).
- [ ] Spec 0018 must be merged (or its PR #242 settled) first: this spec depends on `resolveCreator`, the registry flag and the session only rule.
- [ ] `/sync` adds the `/mcp` and OAuth rules to `src/server/AGENTS.md`, `src/lib/AGENTS.md` and `src/db/AGENTS.md` once built.

## Rationale

See [rationale.md](rationale.md): the context, the options considered, why option 1 won and the references.
