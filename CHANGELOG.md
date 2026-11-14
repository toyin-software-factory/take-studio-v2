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

### Changed

- The API error table on `/docs/api` now lists the common take, change and job error codes with their HTTP status, and says a key cannot manage connected apps.
- A request with any `Authorization` header is judged by the key alone. A wrong or revoked key is 401 `invalid_api_key`, and the browser session is never used as a fallback.

### Security

- Keys are stored only as a hash. The key itself is shown once, never logged, and accepted only in the header, never in a link.
- Key routes, sign in, change email, change password, sign out and delete account refuse a key (401 `session_required`), so a leaked key cannot make more keys or lock you out.
