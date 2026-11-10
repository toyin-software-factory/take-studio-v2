# 0002. Data model: rationale

## Context

Take Studio needs a durable record of each creator's takes and everything the pipeline produces: processing progress, the cuts found (and who decided them), finished videos, transcripts, reusable backgrounds, monthly usage, and later API keys. Slices 1 to 7 each touch this data, so a model invented slice by slice would need breaking migrations (renaming columns, splitting tables) as the review timeline, AI agents, retention and the public API arrive.

The forces: creators own personal data (videos of themselves, transcripts) that must be private to them and fully removable. Processing is asynchronous and can fail or be retried, so progress and retries need explicit state. The free plan has a monthly limit that must not be gamed by deleting and recreating an account, yet we should keep no personal data after deletion. Storage cost matters: renders are large.

Decided with Toyin: track all eight kinds of things; keep only the latest render's video but remember earlier render settings; uploaded backgrounds form a personal library with no expiry; usage counts the original upload's length once at job start, refunds our failures, re renders are free, months reset on the 1st (UTC); 60 free minutes a month as a changeable setting; account deletion removes everything except an anonymous usage count.

## Options considered

### Option 1: Minimal tables, add as we go

Create only `take` with a JSON blob for job state and results now, and add tables when slices need them.

**Pros**: fastest start; fewest tables.
**Cons**: JSON blobs hide state that needs constraints (one active job, latest render); later slices must restructure data, the breaking migrations the scope forbids.

### Option 2: One relational schema, designed whole, created slice by slice (chosen)

Design every table now as the target; each slice's migration creates only its own tables, additively.

**Pros**: constraints in the database (one active job, one latest render, ranges); additive migrations only; clear ownership.
**Cons**: more design up front; some fields wait several slices to be used.

### Option 3: Event log (event sourcing)

Store every action as an event and derive current state.

**Pros**: full history, easy audit.
**Cons**: much more complexity for a small team; projections to maintain; overkill for this product.

## Rationale

Option 2 fits the scope's rule that no later slice needs a breaking change, and lets Postgres enforce the rules that matter most (one active job per take, one latest render, valid cut ranges) instead of hoping code gets them right. Creating tables per slice keeps the Tracer Bullet approach honest: slice 1 ships only what it uses.

An independent cross check (another model) found about 30 gaps in the first draft, mostly atomicity (charge and limit check, job completion, refunds), state holes (abandoned uploads, stuck jobs, failed re renders), cut ownership on re analysis, and file deletion after rows are gone. Toyin approved all recommended fixes, including three product calls: a deleted background makes the next re render ask for a new one; cancels are refunded only before processing starts; email variants count as one person for the free limit.

Usage is keyed by an HMAC of the email rather than the account ID because a rejoining creator gets a new account ID; the HMAC with a server secret holds no readable personal data. Transcript words live in a JSON column because they are always read and written as a whole (display, SRT, AI cleanup); rows per word would add volume with no query benefit. Ownership is enforced in shared data access functions rather than Postgres row level security because the app uses a single database role; ownership tests are mandatory to make up for it.
