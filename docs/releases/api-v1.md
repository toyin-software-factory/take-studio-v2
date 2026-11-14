# Take Studio API v1

_Released 2026-11-14_

You can now work with Take Studio from your own code. Make a key, send it with each request, and upload, run and download takes without opening the app.

## Highlights

- **API keys**: A key lets your own scripts, tools and assistants do what you can do in the app: upload a take, check on it, read its transcript, change cuts and backgrounds, and download the finished video. It uses your own allowance and your own takes. Nobody else's takes are ever visible to it.
- **Where to make and revoke a key**: Open your account menu, choose API keys, or go to `/account/api-keys`. Name a key, make it, and copy it right away. You see it once, so keep it secret like a password. You can hold 5 keys at once. To stop a key, press Revoke next to it. It stops working on its very next request.
- **Docs you can read and feed to a tool**: The guide is at `/docs/api`, with a worked upload to download example you can copy. The same routes are at `/api/openapi.json` as an OpenAPI 3.1 file for tools that read it.

## Improvements

- **Fair use rules**: Each key can make 120 requests a minute. If you go over, you get a 429 `rate_limited` answer and a `Retry-After` header that says how many seconds to wait. One busy key never slows another.
- **Same rules as the app**: Your free minutes each month, the hourly upload limit and all permissions apply to a key exactly as they do to you.
- **Clearer errors in the docs**: The error table now covers the common codes you can meet while uploading and changing a take.

## Fixes

None.

## Upgrade notes

Nothing to do. Your sign in and the app work as before. Keys cannot make keys, list keys, manage connected apps or delete your account, so do those in the app. Send a key only in the `Authorization: Bearer` header, never in a link. If a key leaks, revoke it on the API keys screen.
