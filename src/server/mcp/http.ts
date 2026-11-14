import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  MCP,
  MCP_INSTRUCTIONS,
  RPC_CODE,
  checkBody,
  rpcErrorBody,
  wwwAuthenticate,
} from "@/lib/mcp-rules";
import { type ApiAuthDeps, guard } from "../api-auth";
import { type McpHandlers, callTool } from "./dispatch";
import { TOOLS, type ToolDef } from "./tools";

/**
 * `POST /mcp` (spec 0019 AC-1, AC-2, AC-10, AC-11): MCP over Streamable HTTP, stateless, one JSON
 * body in and one out. The bearer is judged by the shared guard (a key, never a cookie: with no
 * `Authorization` header there is no creator), and every POST counts against the key's rate
 * limit. A body over 256 KB, a batch and text that is not JSON are refused before the SDK sees
 * them. The log line of a tool call holds the tool, the take ID, the creator ID, the status the
 * route gave and the duration, never arguments or results.
 */

export type McpHttpDeps = {
  readonly keyAuth: ApiAuthDeps["keyAuth"];
  /** The route handler each tool stands for (`deps.ts`). */
  readonly handlers: McpHandlers;
  /** `BETTER_AUTH_URL`, for the `WWW-Authenticate` metadata link. */
  readonly baseUrl: () => string;
  readonly now?: () => number;
};

const NO_STORE = "private, no-store";

function finish(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", NO_STORE);
  return new Response(response.body, { status: response.status, headers });
}

function rpcError(status: number, code: number, message: string): Response {
  return finish(Response.json(rpcErrorBody(code, message), { status }));
}

function registerTools(
  server: McpServer,
  deps: McpHttpDeps,
  caller: { readonly creatorId: string; readonly origin: string; readonly authorization: string },
): void {
  const now = deps.now ?? Date.now;
  const register = (tool: ToolDef) =>
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: tool.annotations,
      },
      async (args: Readonly<Record<string, unknown>> | undefined) => {
        const started = now();
        const outcome = await callTool(tool, args ?? {}, deps.handlers, caller);
        console.info("mcp_call", {
          tool: tool.name,
          takeId: outcome.takeId,
          creatorId: caller.creatorId,
          status: outcome.status,
          durationMs: now() - started,
        });
        return {
          content: [{ type: "text" as const, text: outcome.text }],
          isError: outcome.isError,
        };
      },
    );
  TOOLS.forEach(register);
}

/**
 * Reads the body up to `MCP.maxBodyBytes`, counting bytes as they arrive, so a stream with no
 * (or a false) `Content-Length` is cut off at the limit instead of buffered whole. Null: too big.
 */
async function readBody(request: Request): Promise<string | null> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MCP.maxBodyBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function handleMcp(request: Request, deps: McpHttpDeps): Promise<Response> {
  if (request.method !== "POST") {
    return finish(
      Response.json(
        { error: "method_not_allowed", message: "Send MCP messages with POST." },
        { status: 405, headers: { allow: "POST" } },
      ),
    );
  }
  const creator = await guard(
    request,
    { getCreator: async () => null, keyAuth: deps.keyAuth },
    { checkOrigin: false },
  );
  if (creator instanceof Response) {
    if (creator.status === 401) {
      creator.headers.set("www-authenticate", wwwAuthenticate(deps.baseUrl()));
    }
    return finish(creator);
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MCP.maxBodyBytes) {
    return rpcError(413, RPC_CODE.invalidRequest, "The request is too large.");
  }
  const text = await readBody(request);
  if (text === null) return rpcError(413, RPC_CODE.invalidRequest, "The request is too large.");
  const checked = checkBody(text);
  if (!checked.ok) return rpcError(checked.status, checked.code, checked.message);
  try {
    const server = new McpServer(
      { name: MCP.serverName, version: MCP.serverVersion },
      { instructions: MCP_INSTRUCTIONS },
    );
    registerTools(server, deps, {
      creatorId: creator.creatorId,
      origin: new URL(request.url).origin,
      authorization: request.headers.get("authorization") ?? "",
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const headers = new Headers(request.headers);
    headers.set("accept", "application/json, text/event-stream");
    const forwarded = new Request(request.url, { method: "POST", headers });
    return finish(await transport.handleRequest(forwarded, { parsedBody: checked.message }));
  } catch {
    return rpcError(500, RPC_CODE.internal, "Something went wrong. Please try again.");
  }
}
