import { captureMessage } from "@sentry/core";
import { routeKey } from "@/lib/api-registry";
import { composeStartUpload, firstBatch, parseCreated, parseLinks } from "./start-upload";
import { type ToolDef, pathInputKeys, placeholders } from "./tools";

/**
 * The internal dispatch of the MCP server (spec 0019 AC-3, AC-7, AC-8). Calling a tool builds an
 * internal `Request` for the route it stands for (same method, path, JSON body or query, and the
 * caller's own `Authorization` header) and runs that route's exported handler in this Worker: no
 * network hop, so the guard, the ownership query, the monthly allowance and every error code are
 * the route's own. The one rule this file owns is the delete guard (`confirm: true`). It holds no
 * limit or permission logic. The answer is the route's body as text, never changed.
 */

export type RouteParams = Readonly<Record<string, string>>;
/** The handler of one route, called with the path parts the request URL carries. */
export type RouteHandler = (request: Request, params: RouteParams) => Promise<Response>;
/** The exported handler of every route that is a tool, keyed by `routeKey` ("METHOD path"). */
export type McpHandlers = Readonly<Record<string, RouteHandler>>;

export type ToolContext = { readonly origin: string; readonly authorization: string };
type Input = Readonly<Record<string, unknown>>;

export type ToolOutcome = {
  /** The HTTP status the route gave. */
  readonly status: number;
  /** True for any answer that is not a 2xx: the text is the route's own `{ error, message }`. */
  readonly isError: boolean;
  /** The route's body, unchanged (a route with no body answers `{}`). */
  readonly text: string;
  /** The take the call was about, when the input names one (for the log line only). */
  readonly takeId: string | null;
};

const takeIdOf = (input: Input): string | null =>
  typeof input.takeId === "string" ? input.takeId : null;

/** Path parts, from the input, for the handler and the URL. A missing part is an empty string. */
export function pathParams(tool: ToolDef, input: Input): RouteParams {
  const names = placeholders(tool.route.path);
  const keys = pathInputKeys(tool.route.path);
  return Object.fromEntries(names.map((name, i) => [name, String(input[keys[i] ?? name] ?? "")]));
}

function pathOf(tool: ToolDef, params: RouteParams): string {
  return tool.route.path.replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(params[name] ?? ""),
  );
}

/** The input that is neither a path part nor the guard: the route's query or body fields. */
function payloadOf(tool: ToolDef, input: Input): Readonly<Record<string, unknown>> {
  const skip = new Set<string>([...pathInputKeys(tool.route.path), "confirm"]);
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => !skip.has(key) && value !== undefined),
  );
}

/** Builds the internal request for a tool, with the caller's own `Authorization` header. */
export function buildRouteRequest(tool: ToolDef, input: Input, context: ToolContext): Request {
  const params = pathParams(tool, input);
  const payload = payloadOf(tool, input);
  const headers = new Headers({ authorization: context.authorization });
  const base = `${context.origin}${pathOf(tool, params)}`;
  if (tool.route.method === "GET") {
    const query = new URLSearchParams(
      Object.entries(payload).map(([key, value]) => [key, String(value)]),
    ).toString();
    return new Request(query === "" ? base : `${base}?${query}`, { method: "GET", headers });
  }
  const hasBody = Object.keys(payload).length > 0;
  if (hasBody) headers.set("content-type", "application/json");
  return new Request(base, {
    method: tool.route.method,
    headers,
    body: hasBody ? JSON.stringify(payload) : undefined,
  });
}

const refused = (status: number, error: string, message: string, takeId: string | null) => ({
  status,
  isError: true,
  text: JSON.stringify({ error, message }),
  takeId,
});

const INTERNAL_MESSAGE = "Something went wrong on our side. Try again in a moment.";

/** One Sentry message with IDs and the error class name only, never the message or the input. */
function reportToolFailure(tool: string, takeId: string | null, error: unknown): void {
  captureMessage("mcp_tool_failed", {
    level: "error",
    tags: { service: "web", tool },
    extra: { takeId, errorName: error instanceof Error ? error.constructor.name : "unknown" },
  });
}

/** Runs one tool through its route and returns the route's answer as the tool outcome. */
export async function callTool(
  tool: ToolDef,
  input: Input,
  handlers: McpHandlers,
  context: ToolContext,
): Promise<ToolOutcome> {
  const takeId = takeIdOf(input);
  if (tool.confirm && input.confirm !== true) {
    return refused(
      400,
      "confirmation_required",
      "Nothing was deleted. Ask the creator whether to delete this take, and only if they say yes call this again with confirm set to true.",
      takeId,
    );
  }
  const handler = handlers[routeKey(tool.route)];
  if (handler === undefined) {
    return refused(500, "tool_unavailable", "This tool isn't available right now.", takeId);
  }
  let response: Response;
  try {
    response = await handler(buildRouteRequest(tool, input, context), pathParams(tool, input));
  } catch (error) {
    // A route that throws (database, storage) must not hand its message to the assistant: it can
    // hold SQL and values. The answer is fixed; the report carries the tool, take and error name.
    reportToolFailure(tool.name, takeId, error);
    return refused(500, "internal", INTERNAL_MESSAGE, takeId);
  }
  const text = response.status === 204 ? "{}" : await response.text();
  const ok = response.status >= 200 && response.status <= 299;
  if (ok && tool.name === "start_upload") {
    return startUploadOutcome(response.status, text, handlers, context);
  }
  return { status: response.status, isError: !ok, text, takeId };
}

const PARTS_ROUTE = "POST /api/uploads/{takeId}/parts";

/**
 * `start_upload` answers with the first batch of part links too (AC-5): one more call of the
 * parts route, as the caller. When that fails the answer still has the take and the steps, which
 * name get_upload_part_links. The links stay in the answer only; the log line never sees them.
 */
async function startUploadOutcome(
  status: number,
  text: string,
  handlers: McpHandlers,
  context: ToolContext,
): Promise<ToolOutcome> {
  const created = parseCreated(text);
  if (created === null) return { status, isError: false, text, takeId: null };
  const libraryUrl = `${context.origin}/library`;
  const handler = handlers[PARTS_ROUTE];
  let links = null;
  if (handler !== undefined) {
    const headers = new Headers({
      authorization: context.authorization,
      "content-type": "application/json",
    });
    const request = new Request(`${context.origin}/api/uploads/${created.takeId}/parts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ partNumbers: firstBatch(created.partCount) }),
    });
    try {
      const answer = await handler(request, { takeId: created.takeId });
      if (answer.status >= 200 && answer.status <= 299) links = parseLinks(await answer.text());
    } catch {
      // The links are optional: keep the take ID and the steps, which name get_upload_part_links.
      links = null;
    }
  }
  return {
    status,
    isError: false,
    text: composeStartUpload(created, links, libraryUrl),
    takeId: created.takeId,
  };
}
