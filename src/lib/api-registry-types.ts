/** The shapes of the public API registry (spec 0018 AC-8, AC-16). */

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
export type ExclusionReason = "auth" | "session-only" | "operations" | "documentation" | "guest";

export type ApiExclusion = {
  readonly method: ApiMethod;
  readonly path: string;
  readonly reason: ExclusionReason;
  readonly note: string;
};

type Shape = Pick<ApiRoute, "request" | "response" | "noContent" | "text">;

/** Builds one registry entry; the shape adds the schema names. */
export const route = (
  method: ApiMethod,
  path: string,
  summary: string,
  shape: Shape = {},
): ApiRoute => ({
  method,
  path,
  auth: "session-or-key",
  summary,
  ...shape,
});

export const routeKey = (r: { readonly method: ApiMethod; readonly path: string }): string =>
  `${r.method} ${r.path}`;
