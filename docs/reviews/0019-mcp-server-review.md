# Review, b2-t92-mcp-test-review (spec 0019 MCP server), 2026-11-14

**Reviewed by**: opus (author on sonnet)
**Scope**: spec 0019 MCP and OAuth files in the working tree: `src/server/mcp/*`, `src/app/mcp/route.ts`, `src/lib/{mcp-rules,oauth-rules,oauth-screen,mcp-docs}.ts`, `src/server/oauth/*`, `src/db/data/oauth.ts`, `src/db/schema/oauth.ts`, `src/app/.well-known/**`, `src/server/auth.ts`, `src/server/api-auth.ts`, `src/components/oauth/*`, `src/app/oauth/consent/**`, `src/app/api/connected-apps/**`, the sign in resume path and the `src/trigger/cleanup.ts` OAuth purge
**Verdict**: Changes requested at review time. Both majors are fixed in this PR (see Resolved in this PR); the minors and nits are follow ups.

## Summary
The MCP server is a thin, well tested layer: every tool is derived from the public route registry and calls the same handler with the caller's own header, so ownership, limits and refusals come from the routes. The OAuth side leans on `@better-auth/oauth-provider` sensibly and adds the right local guards (refresh reuse revokes the whole grant, DPoP tokens refused, fixed resume path). Two things should be fixed before this is called done: a disconnect that races a refresh can leave a live grant the creator can no longer see or revoke, and a route that throws sends its raw error message (for a database error, the SQL and its parameters) to the assistant with no log line.

## Resolved in this PR
The reviewer's two majors were small and in scope, so they are fixed here with tests. The text of each finding below is the reviewer's, unchanged.
- **Disconnect racing a refresh**: `authenticateOauthToken` now joins the consent row, so a token pair without consent never authenticates. `disconnectApp` runs its deletes in one transaction, consent first. The `/oauth2/token` before hook refuses a refresh whose grant has no consent (`invalid_grant`). Test: "a token pair that appears after a disconnect does not work, and its refresh is refused" in `src/server/oauth/oauth-flow.test.ts`.
- **Thrown route error leak**: `callTool` catches a throwing handler and answers the fixed `internal` message with status 500. The `mcp_call` line is still written (status 500), and one Sentry message carries the tool, take ID and error class name only. `start_upload` already caught its second handler call. Test: "a route that throws answers a fixed message, logs one line and hides the error text" in `src/server/mcp/http.test.ts`.
- **Tests for the throw path and the disconnect race**: both added with the two fixes.
- Earlier in this task: three oauth flow tests (reuse ends the access tokens, an expired refresh is refused, cleanup of revoked tokens and old rate windows).

## Follow ups (not done in this PR)
- Cap and require `client_name` at registration (80 characters, `invalid_client_metadata`) with a test.
- Keep the OAuth request when the consent page sends a signed out creator to sign in.
- Purge registered clients with no consent, token or refresh row after a day.
- Show the host of this request's `redirect_uri` on the consent page.
- Match unexchanged codes with a JSON check instead of a text prefix.
- The four nits below.

## Major

### 🟠 (fixed) A disconnect racing a refresh leaves a live, invisible grant, `src/db/data/oauth.ts:86`
**Problem**: `disconnectApp` (lines 86 to 109) runs four separate deletes with no transaction: access tokens, refresh tokens, unexchanged codes, then the consent row. A refresh grant handled by the plugin at the same moment (its `handleRefreshTokenGrant` does not look at consent) can read the old refresh row before the second delete and insert a new access and refresh pair after it. `authenticateOauthToken` (lines 18 to 45) checks revoked, expiry, DPoP, resource and a disabled client, but never that an `oauthConsent` row still exists, so the new pair works. The consent row is then gone, so the app does not show in connected apps (`listConnectedApps` starts from `oauthConsent`) and the creator has no button left to revoke it, while rotation keeps it alive for up to 30 days at a time.
**Why it matters**: AC-14 promises that disconnect ends the app's access. Here a creator who disconnects a misbehaving assistant can be left with that assistant still acting on their takes and no way to see or stop it short of deleting the account. The window is small, but an assistant that refreshes often makes it reachable, and the outcome is a security failure, not a glitch.
**Suggested fix**: In scope, small. Make consent part of identity: join `oauthConsent` on user and client in `authenticateOauthToken`, and refuse a refresh in the `/oauth2/token` before hook in `src/server/auth.ts` when no consent row exists for that user and client. Also wrap `disconnectApp` in `runTx` so the four deletes land together. Add a test that disconnects, then inserts a token pair for that client and creator, and expects 401.

### 🟠 (fixed) A thrown route error leaks its message to the assistant and is never logged, `src/server/mcp/dispatch.ts:106`
**Problem**: `callTool` awaits `handler(buildRouteRequest(...), pathParams(...))` with no try or catch. When a handler throws (a database error, a Hyperdrive timeout, an R2 failure that escapes its Result), the SDK catches it in `McpServer` (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:191`) and returns `createToolError(error.message)`, so the raw message becomes the tool result text. A Drizzle error message is `Failed query: <sql> params: <values>`, which carries IDs and can carry titles or transcript words. The `mcp_call` log in `src/server/mcp/http.ts:62` is written only after `callTool` returns, so the throw path writes no log line and no error report.
**Why it matters**: It breaks the project rule that creators see friendly messages and that internals never leak, and it breaks AC-8 and AC-11 (results are data, every call observable). The text lands in a third party assistant's context and transcript, outside our retention rules. Failures in production would also be invisible in logs and Sentry.
**Suggested fix**: In scope, small. Catch around the handler call in `callTool` (and the `startUploadOutcome` handler call at line 144) and return a fixed `{ error: "internal", message: "Something went wrong on our side. Try again in a moment." }` as an `isError` result with status 500. Log `mcp_call` with the tool, take ID, creator ID, status 500 and duration, and report the error to Sentry with IDs only. Add a test with a handler that throws a message containing a secret and assert the result text does not contain it and one log line is written.

## Minor

### 🟡 No length cap on a registered client name, `src/server/auth.ts:103`
**Problem**: The `/oauth2/register` before hook checks redirect URIs and defaults the auth method, but `client_name` is taken as given. Dynamic registration is open to anyone (20 an hour per address).
**Why it matters**: The name is shown on the consent page and in connected apps. A very long name breaks the layout, and a name crafted to look like a sentence ("Take Studio official, allow to continue") is a phishing aid.
**Suggested fix**: In scope, small. Refuse a missing or blank name and one longer than 80 characters with `invalid_client_metadata`, and add a test.

### 🟡 Registered clients that never got consent are never purged, `src/db/data/oauth.ts:144`
**Problem**: `deleteExpiredOauthRows` sweeps tokens and rate windows but no `oauth_client` rows. Anyone can register 20 clients an hour per address, and an abandoned registration stays forever.
**Why it matters**: Slow, unbounded table growth from an unauthenticated endpoint.
**Suggested fix**: Follow up. Delete clients older than a day that have no consent, no token and no refresh row.

### 🟡 Signing in from the consent page loses the OAuth request, `src/app/oauth/consent/page.tsx:31`
**Problem**: `if (!session) redirect("/sign-in")` drops the query, so a creator whose session expired between authorize and consent lands on the library after signing in, and the assistant's flow is dead. The normal path goes through the authorize endpoint's own sign in redirect, so this hits only the expired session case.
**Why it matters**: A confusing dead end in the connect flow (AC-13, AC-15).
**Suggested fix**: In scope, small. Redirect to sign in with the resume parameters that `oauthResumePath` already understands, or to the authorize URL rebuilt from the query.

### 🟡 The consent page shows every registered host, not where this request goes, `src/app/oauth/consent/page.tsx:55`
**Problem**: `redirectHosts(client.redirectUris)` lists all hosts the client registered. The request's own `redirect_uri` is not shown, so a client with one innocent host and one attacker host shows both with no hint which one gets the code.
**Why it matters**: The spec wants the creator to see where they are sent back. The plugin matches the redirect exactly, so this is clarity, not a bypass.
**Suggested fix**: Follow up. Show the host of this request's `redirect_uri` (already checked by the plugin before the page) as the main line.

### 🟡 Unexchanged codes are matched by a JSON text prefix, `src/db/data/oauth.ts:98`
**Problem**: The verification delete relies on the stored value starting with exactly `{"type":"authorization_code"`. Any change in key order or spacing in the plugin's serialization makes the match fail silently, and a code issued just before a disconnect would then still buy tokens.
**Why it matters**: A plugin upgrade could quietly weaken disconnect. The existing test would catch it only if it runs against the upgraded plugin.
**Suggested fix**: Follow up. Match with `value::jsonb ->> 'type' = 'authorization_code'` guarded by a cheap JSON check, or note the dependency next to the plugin version pin.

### 🟡 No tests for the throw path or the disconnect race, `src/server/mcp/tools.test.ts`, `src/server/oauth/oauth-flow.test.ts`
**Problem**: The suites are strong on the happy path and on refusals, but nothing covers a handler that throws or a token pair created after a disconnect. Both are the error handling and security branches behind the two majors.
**Why it matters**: With the test signal configured, untested error and security branches are where regressions hide.
**Suggested fix**: In scope, add with the two fixes (described there).

## Nits
- ⚪ `src/db/data/oauth.ts:68`, "last used" is the newest access token's creation time, which is the last refresh, not the last call; rename to "last connected" or record use in `countOauthRequest`.
- ⚪ `src/server/mcp/dispatch.ts:66`, `String(value)` turns an object or array query value into `[object Object]`; no current GET tool takes one, but `JSON.stringify` or a refusal would be safer.
- ⚪ `src/server/mcp/http.ts:142` and `src/server/mcp/dispatch.ts:130`, the origin and the library link come from `request.url` rather than `BETTER_AUTH_URL`; fine behind the Worker route, but the configured base URL is the one the OAuth metadata uses.
- ⚪ `src/server/api-auth.ts:130`, an invalid OAuth token gets the message "That API key isn't valid", which will confuse a creator who connected by sign in.

## Strengths
- The tool set is generated from the route registry with parity and coverage tests in both directions, and each tool calls the real handler with the caller's header, so ownership (AC-9), limits and refusals cannot drift from the API.
- Careful transport: auth before body, a streamed body cap for requests with no Content-Length, batches refused, `private, no-store` everywhere, and no cookie fallback on `/mcp`.
- OAuth hardening beyond the plugin defaults: refresh reuse deletes the whole grant including consent, DPoP bound tokens are refused on the bearer path, the auth route refuses stray Authorization headers, the sign in resume path is fixed (no open redirect), and the cleanup keeps rotated refresh rows so reuse stays detectable.
- The plugin already enforces the hard parts: PKCE S256 only, `skip_consent` refused in registration, exact redirect matching, no JWKS or metadata fetch (no SSRF surface).
- The delete guard is strict (`confirm !== true`), and the consent and connected apps components handle status and alert roles, focus return and named buttons.

## Test coverage
Coverage is good for the spec as written: transport, identity, parity, ownership for keys and tokens, the delete guard, annotations, the data note, limits, the full OAuth flow (metadata, registration rules, PKCE, code expiry, rotation and reuse, Deny, the registration limit, disconnect, account deletion and cleanup) and the start upload composition. Missing: a handler that throws (no test that the result hides the message and that a log line is written), a refresh or token issued around a disconnect, a long or blank `client_name`, and the signed out consent redirect. The browser specs for consent and connected apps exist and run in CI only.

Reviewed by opus over the files above.
