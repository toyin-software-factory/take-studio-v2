# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Public API (v1, see spec 0018). Every take route now also takes an API key sent as `Authorization: Bearer tsk_…`, with the same ownership, allowance and limits as the signed in app. Upload, process, read the transcript and download the finished video from your own code.
- API keys screen at `/account/api-keys` (user menu, then API keys). Make up to 5 keys, copy a key once when it appears, and revoke one at any time. A revoked key stops on its very next request.
- Rate limit of 120 requests a minute per key. The next request gets 429 `rate_limited` with a `Retry-After` header in seconds.
- API docs at `/docs/api` and the OpenAPI 3.1 file at `/api/openapi.json`, both public and built from one list of routes, so they match the server.
- MCP server for AI agents at `/mcp` (spec 0019). An assistant can list your takes, upload a video, review and apply cuts, and fetch the transcript and the finished video. Each tool calls the same route as the public API, so the same limits and ownership rules apply, and only your own takes are reachable.
- Two ways to connect. Developer tools such as Claude Code and Cursor use an API key. Claude.ai and ChatGPT connect by signing in, with an Allow or Deny screen at `/oauth/consent` and no key to copy.
- Deleting always asks first. The delete tool does nothing unless the assistant sends `confirm: true`, and the assistant is told to ask you before it does.
- Connected apps list on the API keys screen. Each app shows when it connected and when it was last used, and Disconnect ends its access right away.
- `/docs/mcp`: setup for Claude Code, Cursor and other clients, the sign in path, where to see and end connections, a worked example, and every tool, built from the live tool list.

### Changed

- The API error table on `/docs/api` now lists the common take, change and job error codes with their HTTP status, and says a key cannot manage connected apps.
- A request with any `Authorization` header is judged by the key alone. A wrong or revoked key is 401 `invalid_api_key`, and the browser session is never used as a fallback.
- `/docs/mcp` now covers the sign in path and Connected apps. It only described API keys before.
- A refresh from an app you disconnected is refused, and a disconnect now removes the consent and the tokens together.
- A tool call that fails on our side answers a fixed friendly message and is logged with IDs only.

### Security

- Keys are stored only as a hash. The key itself is shown once, never logged, and accepted only in the header, never in a link.
- Key routes, sign in, change email, change password, sign out and delete account refuse a key (401 `session_required`), so a leaked key cannot make more keys or lock you out.
