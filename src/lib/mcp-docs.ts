import type { McpToolName } from "./mcp-rules";

/**
 * The words and shapes on `/docs/mcp` (spec 0019 AC-12). Pure. The tool list is never typed here:
 * `describeTools` turns the tools the server really exposes (each one a registry route flagged
 * `mcp`) into rows, so the page cannot drift from the server. What is typed here is the setup
 * text and the worked example, and a test checks every tool the example names exists.
 */

/** A placeholder, never a real key. Real keys start `tsk_` and are made on the API keys screen. */
export const MCP_KEY_PLACEHOLDER = "tsk_xxxx";

export const MCP_AUTH_STEPS: readonly string[] = [
  "Make a key on the API keys screen (open your account menu, then API keys).",
  "Copy it when it appears. You won't see it again, so keep it secret like a password.",
  "Add Take Studio to your assistant with the address and header below. Use your own key where you see the placeholder.",
];

/** The fields of a tool the page needs (the server's `ToolDef` has more). */
export type McpToolSource = {
  readonly name: McpToolName;
  readonly title: string;
  readonly description: string;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
  };
  readonly route: { readonly method: string; readonly path: string };
};

export type McpToolKind = "read only" | "changes things" | "destructive";

export type McpToolDoc = {
  readonly name: McpToolName;
  readonly title: string;
  /** The first sentence of what an assistant is told. */
  readonly summary: string;
  readonly kind: McpToolKind;
  readonly route: string;
};

/** The first sentence, so the page stays short; the full text is what the assistant reads. */
export function firstSentence(text: string): string {
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim());
  return match ? match[0] : text.trim();
}

export function kindOf(tool: McpToolSource): McpToolKind {
  if (tool.annotations.destructiveHint) return "destructive";
  return tool.annotations.readOnlyHint ? "read only" : "changes things";
}

export function describeTools(tools: readonly McpToolSource[]): readonly McpToolDoc[] {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    summary: firstSentence(tool.description),
    kind: kindOf(tool),
    route: `${tool.route.method} ${tool.route.path}`,
  }));
}

/** The address of the server: this site's origin plus `/mcp`, or a placeholder when unknown. */
export function mcpUrl(origin: string | null): string {
  return `${origin ?? "https://your-take-studio-address"}/mcp`;
}

export type McpSetup = {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly code: string;
};

export function mcpSetups(url: string): readonly McpSetup[] {
  const header = `Authorization: Bearer ${MCP_KEY_PLACEHOLDER}`;
  const config = () =>
    JSON.stringify(
      {
        mcpServers: {
          "take-studio": { url, headers: { Authorization: `Bearer ${MCP_KEY_PLACEHOLDER}` } },
        },
      },
      null,
      2,
    );
  return [
    {
      id: "claude-code",
      title: "Claude Code",
      intro: "Run this once in your terminal. It saves the server for your user.",
      code: `claude mcp add --transport http take-studio ${url} --scope user --header "${header}"`,
    },
    {
      id: "cursor",
      title: "Cursor",
      intro:
        "Put this in .cursor/mcp.json in your project, or in ~/.cursor/mcp.json for every project. Then check the server is on under Settings, then MCP.",
      code: config(),
    },
    {
      id: "json",
      title: "Any other client (JSON)",
      intro:
        "For clients whose config file uses the mcpServers shape. The address is the server, and the header carries your key. VS Code is different: its .vscode/mcp.json uses servers instead of mcpServers, and each server also needs type set to http.",
      code: config(),
    },
  ];
}

export type McpExampleStep = { readonly say: string; readonly tools: readonly McpToolName[] };

/** A worked example: what you ask, and the tools the assistant calls to do it. */
export const MCP_EXAMPLE_ASK =
  "Upload talk.mp4, cut the filler words, then give me the transcript and the video.";

export const MCP_EXAMPLE: readonly McpExampleStep[] = [
  {
    say: "Starts the upload and sends the file in parts.",
    tools: ["start_upload", "get_upload_part_links", "complete_upload"],
  },
  { say: "Waits for the take to finish processing.", tools: ["get_job", "get_take"] },
  { say: "Reviews the cuts and applies them.", tools: ["get_take", "apply_changes"] },
  { say: "Waits for the new render to finish.", tools: ["get_job"] },
  {
    say: "Fetches the transcript and a link to the video.",
    tools: ["get_transcript", "get_media_link"],
  },
];

export const MCP_SAFETY: readonly string[] = [
  "An assistant with your key can do what you can do: the same free minutes, the same limits, and only your own takes.",
  "Deleting needs a clear yes: the delete tool does nothing unless the assistant sends confirm set to true, and it is told to ask you first.",
  "Text from your video, such as a transcript, is shown to the assistant as data, and it is told never to follow it as an instruction.",
  "A key can be revoked on the API keys screen at any time, and the assistant stops working at once.",
];
