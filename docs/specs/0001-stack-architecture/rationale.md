# 0001. Stack and architecture: rationale

## Context

Take Studio takes a creator's video take (up to 10 minutes, about 2 GB, MP4 or MOV, up to 1080p), trims long pauses, replaces a green screen with a studio background, and produces an English transcript with captions aligned to the trimmed video. Later, AI agents make the editing calls, and other AI agents use the product through a public API and an MCP server.

The forces: processing is heavy and slow (minutes of ffmpeg work per take on multi GB files), so it cannot run inside a request. Uploads are large, so they must not pass through the web app. Creators come back to past takes, so accounts and a relational record of takes, jobs, cuts and transcripts are needed. Videos are personal data with a 30 day retention promise. The team is small (three agents and Toyin), works in TypeScript, and needs low operations work. Cost per take must stay in cents while the product is free with a monthly limit.

If the stack is not fixed first, every slice would invent its own runtime and storage choices, and the shared schema and job contract would drift.

## Options considered

### Option 1: Next.js on Cloudflare Workers + Trigger.dev workers + Neon + R2 (chosen)

Web app on Workers via OpenNext; video jobs as Trigger.dev tasks with ffmpeg; Neon Postgres via Hyperdrive; R2 for files with chunked direct uploads.

**Pros**: cheap and light web tier; free egress for finished videos; jobs get retries, progress and no time limit with almost no ops; one language.
**Cons**: several vendors; Next.js on Workers needs care; two deploy targets.

### Option 2: Next.js on Vercel + Trigger.dev + Neon + R2

Same as option 1 but the web app on Vercel.

**Pros**: the most polished Next.js hosting, per PR preview links with no setup.
**Cons**: higher cost at scale; one more vendor next to Cloudflare R2. Toyin chose Cloudflare.

### Option 3: Supabase all in one (auth, Postgres, storage) + a container worker

**Pros**: fewer vendors; built in auth and storage.
**Cons**: Supabase free plan caps single uploads at 50 MB, so 2 GB takes still need other handling; a container worker means building retries and progress ourselves.

### Option 4: Everything on one container platform (Fly.io or Railway): web app, worker, Postgres

**Pros**: one place, full control, ffmpeg runs anywhere.
**Cons**: the most ops work for a small team (scaling, queues, restarts); paid egress on finished videos unless paired with R2.

## Rationale

The defining force is the split between a light web tier and heavy, slow video work. Option 1 puts each where it belongs: Workers for the light, cheap, always on web app, and Trigger.dev for long ffmpeg runs with retries and progress built in, so the team writes product code, not job infrastructure. R2 removes egress costs, which matter because every creator downloads their finished video, and its lifecycle rules implement the 30 day retention with no code. Neon gives full Postgres for clearly relational data with branch per PR for safe migrations, and Drizzle plus Better Auth fit Workers and Hyperdrive with the least friction.

Toyin chose Cloudflare over Vercel for the web app; that is reasonable here because the web app is light and sits beside R2, but it carries real risk (OpenNext on Workers is younger than Vercel's Next.js hosting). The scaffold task is therefore required to prove a deploy before any feature work.

Deepgram Nova-3 was chosen over AssemblyAI for its low per minute price plus confirmed word timings and filler word support, both needed for aligned SRT captions and for the AI agents. Claude Opus 5.5 was chosen for the agents because editing judgment is the product's quality and costs only cents per take; we can measure a cheaper model later on real takes.

## References

**Project sources**:
- `docs/scope/scope.md` (approved scope, Tracer Bullet, Beta workflow)
- `ROLE.md` (coding standards: TypeScript strict, zod validation, WCAG AA)

**Practices & standards**:
- Monolith first for a small team
- Object storage for files, never the database
- Long running work off the request path, in a job runner
- Relational database as the default for relational data

**Links** (web verified 2026-11-10):
- Trigger.dev max duration: https://trigger.dev/docs/runs/max-duration
- Trigger.dev pricing: https://trigger.dev/pricing
- Trigger.dev ffmpeg extension: https://trigger.dev/docs/config/extensions/ffmpeg
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Cloudflare R2 object lifecycles: https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- Neon pricing: https://neon.com/pricing
- Deepgram pricing: https://deepgram.com/pricing
- Deepgram pre recorded audio: https://developers.deepgram.com/docs/pre-recorded-audio
- Deepgram filler words: https://developers.deepgram.com/docs/filler-words
- AssemblyAI pricing: https://www.assemblyai.com/pricing
- Claude models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Supabase pricing: https://supabase.com/pricing
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
