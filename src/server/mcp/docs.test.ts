import { describe, expect, it } from "vitest";
import { API_REGISTRY } from "@/lib/api-registry";
import { describeTools } from "@/lib/mcp-docs";
import { MCP_TOOL_NAMES } from "@/lib/mcp-rules";
import { TOOLS } from "./tools";

describe("describeTools", () => {
  const docs = describeTools(TOOLS);

  it("has one row for every registry route flagged mcp, and no others (AC-12)", () => {
    const flagged = API_REGISTRY.filter((r) => r.mcp !== undefined)
      .map((r) => r.mcp)
      .sort();
    expect(docs.map((d) => d.name).sort()).toEqual(flagged);
    expect([...MCP_TOOL_NAMES].sort()).toEqual(flagged);
  });

  it("names the route each tool uses", () => {
    for (const route of API_REGISTRY.filter((r) => r.mcp !== undefined)) {
      const row = docs.find((d) => d.name === route.mcp);
      expect(row?.route).toBe(`${route.method} ${route.path}`);
    }
  });

  it("marks reads, changes and the delete", () => {
    const kind = (name: string) => docs.find((d) => d.name === name)?.kind;
    expect(kind("get_usage")).toBe("read only");
    expect(kind("rename_take")).toBe("changes things");
    expect(kind("delete_take")).toBe("destructive");
  });

  it("gives every tool a short summary that is a sentence", () => {
    for (const d of docs) expect(d.summary).toMatch(/[.!?]$/);
  });
});
