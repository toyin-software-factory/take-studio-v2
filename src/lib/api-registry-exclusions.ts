import type { ApiExclusion, ApiMethod, ExclusionReason } from "./api-registry-types";

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
    "GET",
    "/api/connected-apps",
    "session-only",
    "Lists the apps connected with sign in. An app's own token cannot list apps.",
  ),
  exclusion(
    "DELETE",
    "/api/connected-apps/{id}",
    "session-only",
    "Disconnects an app and ends its tokens. Session only.",
  ),
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
