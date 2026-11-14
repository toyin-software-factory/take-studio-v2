import type { Metadata } from "next";
import { McpDocsPage } from "@/components/docs/mcp-docs-page";
import { describeTools, mcpUrl } from "@/lib/mcp-docs";
import { siteOrigin } from "@/lib/site";
import { TOOLS } from "@/server/mcp/tools";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Connect Claude Code, Cursor or any MCP assistant to Take Studio with your API key, and the tools it can use.";

export function generateMetadata(): Metadata {
  const origin = siteOrigin(process.env.BETTER_AUTH_URL);
  return {
    ...(origin ? { metadataBase: new URL(origin), alternates: { canonical: "/docs/mcp" } } : {}),
    title: "AI assistants · Take Studio",
    description: DESCRIPTION,
  };
}

/** The public MCP setup docs (spec 0019 AC-12): the tool list is built from the registry's `mcp` flags. */
export default function McpDocs() {
  const url = mcpUrl(siteOrigin(process.env.BETTER_AUTH_URL));
  return <McpDocsPage url={url} tools={describeTools(TOOLS)} />;
}
