import { describe, expect, it } from "vitest";
import { MCP_EXAMPLE, MCP_KEY_PLACEHOLDER, firstSentence, mcpSetups, mcpUrl } from "./mcp-docs";
import { MCP_TOOL_NAMES } from "./mcp-rules";

describe("firstSentence", () => {
  it("cuts at the first full stop followed by a space", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
  });
  it("keeps a single sentence, and text with no end mark", () => {
    expect(firstSentence("Only this.")).toBe("Only this.");
    expect(firstSentence("No end mark")).toBe("No end mark");
  });
});

describe("setup text", () => {
  const url = mcpUrl("https://take.example.com");
  const setups = mcpSetups(url);

  it("points at this site's /mcp, with a placeholder when the origin is unknown", () => {
    expect(url).toBe("https://take.example.com/mcp");
    expect(mcpUrl(null)).toMatch(/\/mcp$/);
  });

  it("covers Claude Code, Cursor and JSON, each with the address and a placeholder key only", () => {
    expect(setups.map((s) => s.id)).toEqual(["claude-code", "cursor", "json"]);
    for (const s of setups) {
      expect(s.code).toContain(url);
      expect(s.code).toContain(MCP_KEY_PLACEHOLDER);
      expect(s.code).not.toMatch(/tsk_[A-Za-z0-9]{16,}/);
    }
  });

  it("gives valid JSON for Cursor and the plain config", () => {
    for (const id of ["cursor", "json"]) {
      const parsed = JSON.parse(setups.find((s) => s.id === id)!.code);
      expect(parsed.mcpServers["take-studio"].url).toBe(url);
    }
  });
});

describe("the worked example", () => {
  it("only names tools that exist", () => {
    for (const step of MCP_EXAMPLE)
      for (const name of step.tools) expect(MCP_TOOL_NAMES).toContain(name);
  });

  it("waits for the new render before fetching the transcript", () => {
    const says = MCP_EXAMPLE.map((s) => s.tools.join(","));
    expect(says.indexOf("get_job")).toBeGreaterThan(says.indexOf("get_take,apply_changes"));
    expect(says.indexOf("get_job")).toBeLessThan(says.indexOf("get_transcript,get_media_link"));
  });

  it("labels the JSON for the mcpServers shape and says what VS Code needs", () => {
    const intro = mcpSetups(mcpUrl(null)).find((s) => s.id === "json")!.intro;
    expect(intro).toContain("mcpServers");
    expect(intro).toContain(".vscode/mcp.json");
  });
});
