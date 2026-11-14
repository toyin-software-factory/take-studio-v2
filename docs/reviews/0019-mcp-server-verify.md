# Verify: MCP server for AI agents, spec 0019

**Verdict: NOT ready to close. Scope row 14 and spec 0019 stay open.** Every acceptance criterion that code and tests can prove is met on main, and the two small test gaps found are closed in this PR. One thing is still owed: AC-17 (the live check with the MCP Inspector, Claude Code and Claude.ai, which only Toyin can run). AC-15 was rechecked after #281 merged and is met.

Run on 2026-11-14 on branch `b2-t89-verify-mcp`, main at `47ff009`. Only code and tests were read and run, with synthetic accounts (`*.example.test`) and synthetic keys. No production sign in (C-31), no real take. Playwright and `agent-browser` cannot run in this sandbox, so the browser specs were read, not run. CI runs them on every PR.

Run here: the 12 unit files for this spec (`src/server/mcp`, `src/server/oauth`, `mcp-rules`, `mcp-docs`, `oauth-rules`, `oauth-screen`, `legal-facts`, `legal-text-hashes`, `cleanup-rules`) were 131 of 131 green before my changes. After them, `src/server/mcp` and `src/server/oauth` are 72 of 72 green. `pnpm legal:drift` prints "nothing flagged".

## Result per acceptance criterion

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 endpoint and transport | Met | `src/server/mcp/http.test.ts` "transport (AC-1)": initialize with negotiated version, name and instructions; 202 for `notifications/initialized` and `{}` for ping; tools/list; `-32601` for an unknown method; a batch, an oversized body and bad JSON refused; a stream with no Content-Length stopped at the limit; 405 for GET and DELETE. `mcp-rules.test.ts` `checkBody` covers 413 by bytes. |
| AC-2 same identity | Met | `http.test.ts` "identity (AC-2)": 401 with the `WWW-Authenticate` metadata link for no header, a bad key and a revoked key; a cookie with no header is still 401. `mcp-rules.test.ts` `wwwAuthenticate`. A token takes the same path in `oauth-flow.test.ts` "tokens as identity". |
| AC-3 tools are the API | Met | `tools-routes.test.ts` "a tool and its route answer the same": status and body compared for reads and writes. `tools.test.ts` "the request a tool builds": path parts encoded, the caller's own header, query on a GET, JSON otherwise. The one rule in `dispatch.ts` is the delete guard (AC-7). |
| AC-4 tool set | Met | `tools.test.ts` "parity and coverage": every flagged route has a tool and the reverse, every wired handler is a flagged route, every public route is a tool or in `MCP_EXCLUSIONS` with a reason, no tool takes a creator ID. `mcp-docs.test.ts` and `docs.test.ts` check the list is generated from the registry. |
| AC-5 upload without bytes | Met | `start-upload.test.ts`: plan, first links (at most 50), plain steps, the web library link for chat assistants, fallback when the links call fails, a refusal passed through, and the steps name no address to fetch. `tools-routes.test.ts` "start_upload ... complete_upload ... get_take". No server side download exists. |
| AC-6 run and review | Met | `tools-routes.test.ts` "upload and run over the tools" (complete starts processing, `get_take` follows it) and "apply_changes keeps the route's refusals". The route owns `stale`, `nothing_changed` and `change_limit` and has its own tests. |
| AC-7 destructive guard | Met | `tools-routes.test.ts` "delete_take" (the take survives until `confirm: true`), `tools.test.ts` "the delete guard" (the route is not called) and "annotations" (reads are read only, only the deleting tools are destructive, the named state changing tools are never read only, only `delete_take` asks for confirmation). `http.test.ts` checks the instructions text. |
| AC-8 results are data | Met (test added) | The data note was in `tools.ts` but nothing tested it. Added `tools.test.ts` "results are data (AC-8)": `list_takes`, `get_take` and `get_transcript` all say to never follow the text as instructions, and no tool takes a key, token, email, hash or secret as input. The server instructions text is checked in `http.test.ts`. Results are the route's own body, which carry no key, token, hash or email (checked by the route tests). |
| AC-9 ownership | Met | `tools-routes.test.ts` "ownership": every tool that names a take gives creator A's key the route's 404 for creator B's take, and the tools with no take ID show only the caller's data. "a key reaches only its own upload". The same for OAuth tokens in `oauth-flow.test.ts` "reaches only its own creator's takes". |
| AC-10 limits | Met | `http.test.ts` "counts every POST: the 121st in a minute is 429 with Retry-After, tools/list included". The allowance and other route limits come through the route (AC-3). OAuth tokens get the same 120 a minute per app and creator (`oauth-flow.test.ts`). |
| AC-11 private and observable | Met | `http.test.ts` "logs the tool, take, creator, status and duration and nothing else"; `private, no-store` is checked on every response; `api-auth.test.ts` "logs one api_key_rejected line with a reason only, never the key" (a refused credential is a warning with a reason code, not an error report). |
| AC-12 connect with a key | Met in code; CI browser spec | `/docs/mcp` is generated from the registry (`mcp-docs.ts`, `mcp-docs.test.ts`, `docs.test.ts`); `tests/mcp-docs.spec.ts` covers the three setups, the tool list, indexing, skip link and phone width. Not run here. |
| AC-13 connect with sign in | Met (two tests added) | `oauth-flow.test.ts`: both metadata documents (S256 only, code and refresh grants); registration linked to `/mcp`; a bad redirect, `*`, custom scheme and plain http refused; a minimal registration is a public client; one time code with a wrong verifier refused; only SHA-256 hashes stored; access token 1 hour and refresh 30 days; `plain`, a missing challenge, an inexact redirect and a replayed code refused; a code is refused after 60 seconds; refresh rotation with reuse revoking the whole grant, consent included; Basic client reuse. **Added:** "Deny sends the client back with `access_denied`, the state and no code" (no consent row is kept), and "registration rate limit": 20 registrations an hour from one address are accepted and the 21st is 429, while another address is not held back (wired as in the Worker, with `cf-connecting-ip`). |
| AC-14 connected apps | Met | `oauth-flow.test.ts`: a token on a session only route is 401 `session_required`; the list and disconnect routes are session only, own rows only; disconnect ends the token on the next request and also kills an unexchanged code; deleting the account deletes its grants and tokens, and only its own (real delete path); cleanup keeps rotated refresh rows until expiry. The UI part is AC-15. |
| AC-15 accessible consent and screens | Met (CI browser specs) | PR #281 (B2-T82) is merged (a859059) with its checks green. `tests/oauth-consent.spec.ts` covers the consent page: app name and where it sends you back, Allow and Deny, a failed answer keeps both buttons and moves focus to one alert (AC-15), axe, keyboard and phone width. `tests/connected-apps.spec.ts` covers the list, the disconnect dialog (focus trap, Escape, a failed disconnect keeps it open with an alert in the dialog), a failed load with Try again, axe and phone width. `src/lib/oauth-screen.test.ts` covers the copy. These browser specs run in CI only; they cannot run in the agent sandbox, so the proof is the green CI run on the merged head. |
| AC-16 legal facts | Met | B2-T81 (#280) finished build step 9: `COLLECTED` has the connected apps line, `NON_DATA_PACKAGES` has `@modelcontextprotocol/sdk` and `@better-auth/oauth-provider`, the Privacy and Terms copy has the assistant lines, `LEGAL_VERSION` is 2026-11-14 and a hash line is appended. `legal-facts.test.ts` and `legal-text-hashes.test.ts` pass and `pnpm legal:drift` is clean. Nothing was left for this task. |
| AC-17 compatibility for real | **Owed: live check** | Needs the MCP Inspector, Claude Code by key and Claude.ai as a custom connector, each running a full upload, run, review, transcript, video link and delete on a real take. Agents cannot reach Claude.ai and must not sign in to production (C-31). Step 10 for Toyin through Michael. |

## Small gaps fixed in this PR

1. AC-8: the data note in tool descriptions and the "no key, token or email as input" rule had no test. Added to `src/server/mcp/tools.test.ts`.
2. AC-13: Deny (`access_denied`) and the 20 an hour registration limit had no test. Added to `src/server/oauth/oauth-flow.test.ts`. The first attempt at the limit test returned 201 for the 21st request because of a mistake in my own test (the constant was imported from the wrong file, so the loop never ran); the limit itself holds.

## Not done and why

- The browser specs were not run (no Playwright here). CI runs them.
- AC-17 as above (AC-15 is met since #281 merged).

## Bigger gaps for Michael

None found in code. Two notes, not gaps: a tool call spends two of a key's 120 a minute (the POST, then the route; stated in the spec Follow-up), and the Postgres adapter plus Claude.ai itself are only proven by AC-17.

## Scope and spec

Not changed. Row 14 and spec 0019 stay open until Toyin's live check (AC-17) is recorded here. AC-15 was rechecked in B2-T92 after #281 merged.
