/**
 * The public API registry (spec 0018 AC-8, AC-16). Pure data: one entry per public method and
 * path, and one typed exclusion for every route that is not public. `api-registry.test.ts` walks
 * every `route.ts` under `src/app/api` and fails when an exported method is in neither list, so a
 * new web action cannot ship without an API decision. Paths use the folder names of the route
 * files with `[name]` written as `{name}` (the OpenAPI form). `request` and `response` are the
 * names of the zod schemas in `src/lib/api-schemas/` (the docs, `/api/openapi.json` and the schema
 * test read them). The docs page, `/api/openapi.json` and the MCP server read this list. A route
 * with `mcp` is one tool of the MCP server (spec 0019 AC-4); a creator route with no tool is in
 * `MCP_EXCLUSIONS` with its reason.
 */

import type { McpToolName } from "./mcp-rules";

export const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
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
  /** Name of the success response schema; a route with no body (`noContent`) has none. */
  readonly response?: string;
  /** The success answer is 204 with no body. */
  readonly noContent?: true;
  /** The success answer is a text file, not JSON (the transcript download). */
  readonly text?: true;
  /** The MCP tool that stands for this route, when it has one (spec 0019 AC-3, AC-4). */
  readonly mcp?: McpToolName;
};

/** Why a route is not in the public registry. */
export type ExclusionReason = "auth" | "session-only" | "operations" | "documentation";

export type ApiExclusion = {
  readonly method: ApiMethod;
  readonly path: string;
  readonly reason: ExclusionReason;
  readonly note: string;
};

type Shape = Pick<ApiRoute, "request" | "response" | "noContent" | "text">;

const route = (method: ApiMethod, path: string, summary: string, shape: Shape = {}): ApiRoute => ({
  method,
  path,
  auth: "session-or-key",
  summary,
  ...shape,
});

const REGISTRY: readonly ApiRoute[] = [
  route("POST", "/api/uploads", "Start an upload: creates the take and the multipart upload.", {
    request: "UploadCreateRequest",
    response: "UploadCreated",
  }),
  route("POST", "/api/uploads/{takeId}/parts", "Get presigned links to send the upload parts.", {
    request: "UploadPartsRequest",
    response: "UploadPartLinks",
  }),
  route(
    "POST",
    "/api/uploads/{takeId}/complete",
    "Finish the upload, check its size and start processing.",
    { request: "UploadCompleteRequest", response: "UploadCompleted" },
  ),
  route("DELETE", "/api/uploads/{takeId}", "Cancel an upload in progress.", {
    response: "UploadAborted",
  }),
  route("GET", "/api/takes", "List your takes, newest first, 24 per page.", {
    request: "TakeListQuery",
    response: "TakeList",
  }),
  route("GET", "/api/takes/{id}", "One take with its latest job, render and removed time.", {
    response: "TakeDetail",
  }),
  route("PATCH", "/api/takes/{id}", "Rename a take.", {
    request: "TakeRenameRequest",
    response: "TakeRenamed",
  }),
  route("DELETE", "/api/takes/{id}", "Delete a take and everything under it.", { noContent: true }),
  route(
    "POST",
    "/api/takes/{id}/retry",
    "Try again after a failure that does not use up your allowance.",
    { response: "RetryStarted" },
  ),
  route(
    "GET",
    "/api/takes/{id}/media",
    "A short lived link to play or download the take's video.",
    { request: "MediaQuery", response: "MediaLink" },
  ),
  route("GET", "/api/takes/{id}/transcript", "The take's transcript state and paragraphs.", {
    response: "TranscriptView",
  }),
  route("POST", "/api/takes/{id}/transcript", "Make the transcript, or try again.", {
    response: "TranscriptMaking",
  }),
  route(
    "GET",
    "/api/takes/{id}/transcript/{format}",
    "The transcript as a text, SRT or WebVTT file.",
    { request: "TranscriptFileQuery", response: "TranscriptFile", text: true },
  ),
  route(
    "PATCH",
    "/api/takes/{id}/transcript/edits/{index}",
    "Undo or redo one AI transcript fix.",
    { request: "TranscriptUndoRequest", response: "TranscriptEditChanged" },
  ),
  route("POST", "/api/takes/{id}/changes", "Render cut changes and a background choice together.", {
    request: "ChangesRequest",
    response: "JobStarted",
  }),
  route(
    "PUT",
    "/api/takes/{id}/background",
    "Change the take's background with a free re render.",
    { request: "BackgroundChangeRequest", response: "JobStarted" },
  ),
  route(
    "POST",
    "/api/takes/{id}/background/preview",
    "Start, or reuse, a still of the take on a background.",
    { request: "BackgroundPreviewRequest", response: "BackgroundPreview" },
  ),
  route(
    "GET",
    "/api/takes/{id}/background/preview",
    "Read that still: its state and, when ready, a link.",
    { request: "BackgroundPreviewRequest", response: "BackgroundPreview" },
  ),
  route("GET", "/api/takes/{id}/jobs/{jobId}", "The status of one job of this take.", {
    response: "JobStatus",
  }),
  route(
    "GET",
    "/api/takes/{id}/waveform",
    "The stored waveform of the original's audio, or null.",
    { response: "Waveform" },
  ),
  route("POST", "/api/takes/{id}/missed", "Mark a time where a cut was missed; changes no cut.", {
    request: "MissedRequest",
    noContent: true,
  }),
  route("GET", "/api/backgrounds", "The built in studios and your own backgrounds.", {
    response: "BackgroundList",
  }),
  route("POST", "/api/backgrounds", "Start a background upload: a presigned link for the image.", {
    request: "BackgroundUploadRequest",
    response: "BackgroundUploadStarted",
  }),
  route(
    "POST",
    "/api/backgrounds/{id}/complete",
    "Finish a background upload and start processing.",
    { response: "BackgroundUploadCompleted" },
  ),
  route("DELETE", "/api/backgrounds/{id}", "Delete one of your uploaded backgrounds.", {
    noContent: true,
  }),
  route("GET", "/api/account/email-prefs", "Whether take emails are on.", {
    response: "EmailPrefs",
  }),
  route("PATCH", "/api/account/email-prefs", "Turn take emails on or off.", {
    request: "EmailPrefsRequest",
    response: "EmailPrefs",
  }),
  route("GET", "/api/usage", "Your monthly usage against the free allowance.", {
    response: "Usage",
  }),
];

/** Which tool stands for which route (spec 0019 AC-4): `"METHOD path"` to the tool's name. */
const MCP_TOOLS: Readonly<Record<string, McpToolName>> = {
  "GET /api/usage": "get_usage",
  "GET /api/takes": "list_takes",
  "GET /api/takes/{id}": "get_take",
  "PATCH /api/takes/{id}": "rename_take",
  "DELETE /api/takes/{id}": "delete_take",
  "POST /api/uploads": "start_upload",
  "POST /api/uploads/{takeId}/parts": "get_upload_part_links",
  "POST /api/uploads/{takeId}/complete": "complete_upload",
  "DELETE /api/uploads/{takeId}": "abort_upload",
  "POST /api/takes/{id}/retry": "retry_take",
  "GET /api/takes/{id}/jobs/{jobId}": "get_job",
  "GET /api/takes/{id}/media": "get_media_link",
  "GET /api/takes/{id}/transcript": "get_transcript",
  "POST /api/takes/{id}/transcript": "make_transcript",
  "GET /api/takes/{id}/transcript/{format}": "get_transcript_file",
  "PATCH /api/takes/{id}/transcript/edits/{index}": "undo_ai_fix",
  "GET /api/backgrounds": "list_backgrounds",
  "PUT /api/takes/{id}/background": "change_background",
  "POST /api/takes/{id}/background/preview": "preview_background",
  "GET /api/takes/{id}/background/preview": "get_background_preview",
  "POST /api/takes/{id}/changes": "apply_changes",
  "GET /api/takes/{id}/waveform": "get_waveform",
  "POST /api/takes/{id}/missed": "mark_missed",
};

/** The public registry, with each route's MCP tool flag (spec 0019 AC-4). */
export const API_REGISTRY: readonly ApiRoute[] = REGISTRY.map((r) => {
  const mcp = MCP_TOOLS[`${r.method} ${r.path}`];
  return mcp === undefined ? r : { ...r, mcp };
});

/** A registry route that is not a tool, with the reason (spec 0019 AC-4). */
export type McpExclusion = {
  readonly method: ApiMethod;
  readonly path: string;
  readonly note: string;
};

export const MCP_EXCLUSIONS: readonly McpExclusion[] = [
  {
    method: "POST",
    path: "/api/backgrounds",
    note: "Background library upload: the image is sent from the creator's browser, not by an assistant.",
  },
  {
    method: "POST",
    path: "/api/backgrounds/{id}/complete",
    note: "Background library upload: the second half of the browser upload.",
  },
  {
    method: "DELETE",
    path: "/api/backgrounds/{id}",
    note: "Background library upload: managing uploaded images stays in the web app.",
  },
  {
    method: "GET",
    path: "/api/account/email-prefs",
    note: "Email settings belong to the creator, not to an assistant.",
  },
  {
    method: "PATCH",
    path: "/api/account/email-prefs",
    note: "Email settings belong to the creator, not to an assistant.",
  },
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
    "POST",
    "/api/realtime/token",
    "session-only",
    "Mints a short lived Deepgram token for the recorder's voice following. Session only.",
  ),
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
