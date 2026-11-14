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
});
