import {
  MCP_APPS_NOTE,
  MCP_AUTH_STEPS,
  MCP_EXAMPLE,
  MCP_EXAMPLE_ASK,
  MCP_SAFETY,
  MCP_SIGNIN_STEPS,
  mcpSetups,
  type McpToolDoc,
} from "@/lib/mcp-docs";
import { DocsShell } from "./docs-shell";

const TOC = [
  { id: "start", title: "Start here" },
  { id: "auth", title: "Get a key" },
  { id: "setup", title: "Connect your assistant" },
  { id: "signin", title: "Connect by signing in" },
  { id: "apps", title: "See and end connections" },
  { id: "example", title: "A worked example" },
  { id: "safety", title: "What an assistant can do" },
  { id: "tools", title: "Every tool" },
] as const;

const code = "rounded-sm bg-panel px-1 font-mono text-[0.9em]";
const link = "underline underline-offset-4 pointer-coarse:inline-block pointer-coarse:min-h-11";
const pre =
  "overflow-x-auto rounded-md border border-border bg-panel p-4 font-mono text-sm outline-hidden focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring";

/**
 * `/docs/mcp`: how to connect an AI assistant (spec 0019 AC-12). Public, the same signed in or out.
 * The tool list is handed in, built from the registry by the page, so it cannot drift.
 */
export function McpDocsPage({
  url,
  tools,
}: Readonly<{ url: string; tools: readonly McpToolDoc[] }>) {
  return (
    <DocsShell toc={TOC}>
      <div id="start" className="flex scroll-mt-8 flex-col gap-3">
        <h1 className="text-h2">Take Studio for AI assistants</h1>
        <p>
          Connect Claude Code, Cursor or any assistant that speaks MCP, and ask it to work on your
          takes: upload a video, review the cuts, fetch the transcript and the finished video. The
          server is at <code className={code}>{url}</code>.
        </p>
        <p>
          Prefer your own code? See the{" "}
          <a href="/docs/api" className={link}>
            API docs
          </a>
          .
        </p>
      </div>
      <section id="auth" aria-labelledby="h-auth" className="flex scroll-mt-8 flex-col gap-3">
        <h2 id="h-auth" className="text-h3">
          Get a key
        </h2>
        <ol className="flex list-decimal flex-col gap-1 pl-6">
          {MCP_AUTH_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section id="setup" aria-labelledby="h-setup" className="flex scroll-mt-8 flex-col gap-6">
        <h2 id="h-setup" className="text-h3">
          Connect your assistant
        </h2>
        {mcpSetups(url).map((setup) => (
          <div key={setup.id} className="flex flex-col gap-2">
            <h3 className="text-h4">{setup.title}</h3>
            <p>{setup.intro}</p>
            <pre tabIndex={0} aria-label={`Setup for ${setup.title}`} className={pre}>
              <code>{setup.code}</code>
            </pre>
          </div>
        ))}
      </section>
      <section id="signin" aria-labelledby="h-signin" className="flex scroll-mt-8 flex-col gap-3">
        <h2 id="h-signin" className="text-h3">
          Connect by signing in
        </h2>
        <p>
          Developer tools such as Claude Code and Cursor use a key. Claude.ai and ChatGPT connect
          by signing in instead, with no key to copy.
        </p>
        <ol className="flex list-decimal flex-col gap-1 pl-6">
          {MCP_SIGNIN_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
      <section id="apps" aria-labelledby="h-apps" className="flex scroll-mt-8 flex-col gap-3">
        <h2 id="h-apps" className="text-h3">
          See and end connections
        </h2>
        <p>{MCP_APPS_NOTE}</p>
      </section>
      <section id="example" aria-labelledby="h-example" className="flex scroll-mt-8 flex-col gap-3">
        <h2 id="h-example" className="text-h3">
          A worked example
        </h2>
        <p>
          You say: <em>{MCP_EXAMPLE_ASK}</em> The assistant then works through these tools.
        </p>
        <ol className="flex list-decimal flex-col gap-2 pl-6">
          {MCP_EXAMPLE.map((step) => (
            <li key={step.say}>
              {step.say}{" "}
              {step.tools.map((name, i) => (
                <span key={name}>
                  {i > 0 ? ", " : ""}
                  <code className={code}>{name}</code>
                </span>
              ))}
            </li>
          ))}
        </ol>
      </section>
      <section id="safety" aria-labelledby="h-safety" className="flex scroll-mt-8 flex-col gap-3">
        <h2 id="h-safety" className="text-h3">
          What an assistant can do
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-6">
          {MCP_SAFETY.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section id="tools" aria-labelledby="h-tools" className="flex scroll-mt-8 flex-col gap-3">
        <h2 id="h-tools" className="text-h3">
          Every tool
        </h2>
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {tools.map((tool) => (
            <li
              key={tool.name}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <span className="sm:w-64 sm:shrink-0">
                <code className="font-mono text-sm font-semibold break-all">{tool.name}</code>
                <br />
                <span className="text-sm">{tool.kind}</span>
              </span>
              <span className="flex flex-col gap-1">
                <span>{tool.summary}</span>
                <span className="text-sm">
                  Uses <code className="font-mono break-all">{tool.route}</code>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </DocsShell>
  );
}
