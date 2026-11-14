import { handleMcp } from "@/server/mcp/http";
import { mcpHttpDeps } from "@/server/mcp/deps";

export const dynamic = "force-dynamic";

/** The MCP server for AI assistants (spec 0019): one JSON-RPC message in, one JSON body out. */
export function POST(request: Request): Promise<Response> {
  return handleMcp(request, mcpHttpDeps());
}

const notAllowed = (): Response =>
  Response.json(
    { error: "method_not_allowed", message: "Send MCP messages with POST." },
    { status: 405, headers: { allow: "POST", "cache-control": "private, no-store" } },
  );

export const GET = notAllowed;
export const DELETE = notAllowed;
