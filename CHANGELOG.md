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
- Record with script (spec 0021). Record a take in Take Studio at `/record` with your phone or laptop camera, with no export and upload step. Paste a script and a teleprompter shows it near the lens. You can pause it, change the speed (60 to 260 words a minute) and the text size, and use the keys P, the up and down arrows, plus and minus. Speed, size and your script draft are remembered on your device.
- Follow my voice. The prompter moves to where you are in the script by listening to your microphone. The audio goes to Deepgram only while you record with this on, is never stored, and Take Studio falls back to a timed scroll with a visible note when it cannot hear your place. A first time dialog explains this before it turns on.
- Review step for a recording. Play it back, then Use this take, Record again or Save to your device. A recording goes through the normal upload and processing, counts toward your monthly allowance, and stops by itself at 10 minutes or when your allowance runs out. Leaving the page asks first, and a failed upload keeps the file with Try again.
- Clear messages when the camera or microphone is blocked, missing or in use, and a full screen layout with a settings sheet on phones.
- Script aware cuts. When a take has a script, the AI keeps your best attempt of a line you said more than once and cuts the others as false starts. The script shows on the take's Details tab and is deleted with the take and with your account.

### Changed

- The API error table on `/docs/api` now lists the common take, change and job error codes with their HTTP status, and says a key cannot manage connected apps.
- A request with any `Authorization` header is judged by the key alone. A wrong or revoked key is 401 `invalid_api_key`, and the browser session is never used as a fallback.
- `/docs/mcp` now covers the sign in path and Connected apps. It only described API keys before.
- A refresh from an app you disconnected is refused, and a disconnect now removes the consent and the tokens together.
- A tool call that fails on our side answers a fixed friendly message and is logged with IDs only.

### Fixed

- Follow my voice no longer sends your microphone to Deepgram after it has told you it is unavailable. If the connection opened late, past the five second wait, the audio stayed off but the socket could still open and stream.
- The teleprompter keys no longer act behind the Follow my voice dialog, and a paused script starts running again on the next take.

### Security

- Keys are stored only as a hash. The key itself is shown once, never logged, and accepted only in the header, never in a link.
- Key routes, sign in, change email, change password, sign out and delete account refuse a key (401 `session_required`), so a leaked key cannot make more keys or lock you out.
