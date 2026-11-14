/**
 * The public API registry (spec 0018 AC-8, AC-16). Pure data: one entry per public method and
 * path, and one typed exclusion for every route that is not public. `api-registry.test.ts` walks
 * every `route.ts` under `src/app/api` and fails when an exported method is in neither list, so a
 * new web action cannot ship without an API decision. Paths use the folder names of the route
 * files with `[name]` written as `{name}` (the OpenAPI form). `request` and `response` are the
 * names of the zod schemas in `src/lib/api-schemas/` (step 6 fills them in; the docs and the
 * parity test read them). The docs page, `/api/openapi.json` and the MCP server read this list.
 */

export const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type ApiMethod = (typeof API_METHODS)[number];

/** Which credentials a public route takes: every public route takes the session or a key. */
export type ApiAuth = "session-or-key";

export type ApiRoute = {
  readonly method: ApiMethod;
  readonly path: string;
  readonly auth: ApiAuth;
  readonly summary: string;
  /** Name of the request schema (body, or query when there is no body), once step 6 adds it. */
  readonly request?: string;
  /** Name of the success response schema, once step 6 adds it. */
  readonly response?: string;
};

/** Why a route is not in the public registry. */
export type ExclusionReason = "auth" | "session-only" | "operations" | "documentation";

export type ApiExclusion = {
  readonly method: ApiMethod;
  readonly path: string;
  readonly reason: ExclusionReason;
  readonly note: string;
};

const route = (method: ApiMethod, path: string, summary: string): ApiRoute => ({
  method,
  path,
  auth: "session-or-key",
  summary,
});

export const API_REGISTRY: readonly ApiRoute[] = [
  route("POST", "/api/uploads", "Start an upload: creates the take and the multipart upload."),
  route("POST", "/api/uploads/{takeId}/parts", "Get presigned links to send the upload parts."),
  route(
    "POST",
    "/api/uploads/{takeId}/complete",
    "Finish the upload, check its size and start processing.",
  ),
  route("DELETE", "/api/uploads/{takeId}", "Cancel an upload in progress."),
  route("GET", "/api/takes", "List your takes, newest first, 24 per page."),
  route("GET", "/api/takes/{id}", "One take with its latest job, render and removed time."),
  route("PATCH", "/api/takes/{id}", "Rename a take."),
  route("DELETE", "/api/takes/{id}", "Delete a take and everything under it."),
  route(
    "POST",
    "/api/takes/{id}/retry",
    "Try again after a failure that does not use up your allowance.",
  ),
  route("GET", "/api/takes/{id}/media", "A short lived link to play or download the take's video."),
  route("GET", "/api/takes/{id}/transcript", "The take's transcript state and paragraphs."),
  route("POST", "/api/takes/{id}/transcript", "Make the transcript, or try again."),
  route(
    "GET",
    "/api/takes/{id}/transcript/{format}",
    "The transcript as a text, SRT or WebVTT file.",
  ),
  route("PATCH", "/api/takes/{id}/transcript/edits/{index}", "Undo or redo one AI transcript fix."),
  route("POST", "/api/takes/{id}/changes", "Render cut changes and a background choice together."),
  route("PUT", "/api/takes/{id}/background", "Change the take's background with a free re render."),
  route(
    "POST",
    "/api/takes/{id}/background/preview",
    "Start, or reuse, a still of the take on a background.",
  ),
  route(
    "GET",
    "/api/takes/{id}/background/preview",
    "Read that still: its state and, when ready, a link.",
  ),
  route("GET", "/api/takes/{id}/jobs/{jobId}", "The status of one job of this take."),
  route("GET", "/api/takes/{id}/waveform", "The stored waveform of the original's audio, or null."),
  route("POST", "/api/takes/{id}/missed", "Mark a time where a cut was missed; changes no cut."),
  route("GET", "/api/backgrounds", "The built in studios and your own backgrounds."),
  route("POST", "/api/backgrounds", "Start a background upload: a presigned link for the image."),
  route(
    "POST",
    "/api/backgrounds/{id}/complete",
    "Finish a background upload and start processing.",
  ),
  route("DELETE", "/api/backgrounds/{id}", "Delete one of your uploaded backgrounds."),
  route("GET", "/api/account/email-prefs", "Whether take emails are on."),
  route("PATCH", "/api/account/email-prefs", "Turn take emails on or off."),
  route("GET", "/api/usage", "Your monthly usage against the free allowance."),
];

const exclusion = (
  method: ApiMethod,
  path: string,
  reason: ExclusionReason,
  note: string,
): ApiExclusion => ({ method, path, reason, note });

export const API_EXCLUSIONS: readonly ApiExclusion[] = [
  exclusion(
    "GET",
    "/api/auth/{...all}",
    "auth",
    "Sign in, sign out and delete account (needs a fresh sign in). Bearer keys are refused here.",
  ),
  exclusion(
    "POST",
    "/api/auth/{...all}",
    "auth",
    "Same handler as GET: sign in and delete account.",
  ),
  exclusion("GET", "/api/health", "operations", "Liveness check for our own monitoring."),
  exclusion("GET", "/api/sentry-check", "operations", "Error reporting check for our own use."),
  exclusion(
    "GET",
    "/api/keys",
    "session-only",
    "Lists API keys. A key can never list or make keys.",
  ),
  exclusion(
    "POST",
    "/api/keys",
    "session-only",
    "Makes an API key. Session only, so an agent cannot make more.",
  ),
  exclusion("DELETE", "/api/keys/{id}", "session-only", "Revokes an API key. Session only."),
  exclusion(
    "GET",
    "/api/openapi.json",
    "documentation",
    "The documentation itself: public, needs no sign in and takes no key.",
  ),
];

/** `"METHOD path"`, the one key the parity test and the docs use for a route. */
export const routeKey = (r: { readonly method: ApiMethod; readonly path: string }): string =>
  `${r.method} ${r.path}`;
