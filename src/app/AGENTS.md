# App routes and pages (src/app)

Next.js App Router on Workers through OpenNext (no incremental cache, so no ISR and no `revalidate`). The design gallery is in [src/components/AGENTS.md](../components/AGENTS.md), the take pages' UI in [src/components/takes/AGENTS.md](../components/takes/AGENTS.md), and what the API routes call in [src/server/AGENTS.md](../server/AGENTS.md).

## Conventions and gotchas

- Pages and routes are dynamic: each page and API route file exports `dynamic = "force-dynamic"`. Add it to a new one. Today the one exception is `api/auth/[...all]/route.ts`, which builds the Better Auth handler on each request with `getAuth()`.
- `/` signed out shows the landing placeholder (no redirect) and signed in shows the library. `/takes/[id]` signed out redirects to `/` before any lookup; signed in, a missing, foreign or malformed ID gives `notFound()`, the same styled 404 for all three so nothing leaks. `loadTake` is wrapped in React `cache`, so the page and `generateMetadata` share one lookup.
- Error pages: `error.tsx` shows fixed generic text and never `error.message` (the library throws "take list failed" and that must stay hidden), reports with `captureException`, and its Retry does `router.refresh()` then `reset()`. `global-error.tsx` must stand alone: its own `<html>` and `<body>`, its own font and `globals.css` imports, a plain button. Keep its words the same as `error.tsx`.
- Tab titles are written per page and end with "· Take Studio" (`layout.tsx` has no title template). Take titles come from `tabTitle` in `src/lib/take-display.ts`.
- Imports (ESLint): `src/app` may import `@/trigger` only as types, and may not use `@anthropic-ai/sdk`, `fluent-ffmpeg` or `ffmpeg-static`. `src/db` and `src/lib` may not import `@/app`.
- Workers: reach bindings with `getCloudflareContext({ async: true })`. Each `getAuth()` builds a new database client, so do not call it in a loop. Images are unoptimized (no image service on Workers) and fonts are fetched at build time (`src/lib/fonts.ts`).
- `api/health` answers 503 when a check fails. `api/sentry-check` is a plain 404 without the `x-sentry-check` token and throws with it (spec 0005). `src/instrumentation.ts` tags server errors with the route template, never the URL or query.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
