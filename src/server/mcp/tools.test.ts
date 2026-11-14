import { describe, expect, it } from "vitest";
import { z } from "zod";
import { API_REGISTRY, MCP_EXCLUSIONS, routeKey } from "@/lib/api-registry";
import { MCP_TOOL_NAMES } from "@/lib/mcp-rules";
import { buildRouteRequest, callTool } from "./dispatch";
import { buildHandlers } from "./handlers";
import { TOOLS } from "./tools";

/** Spec 0019 AC-4 (parity and coverage), AC-7 (annotations, guard input) and AC-3 (request build). */
const unusedDeps = () => {
  throw new Error("not wired");
};
const handlers = buildHandlers({
  usage: unusedDeps,
  take: unusedDeps,
  media: unusedDeps,
  transcript: unusedDeps,
  upload: unusedDeps,
  library: unusedDeps,
  preview: unusedDeps,
});
const tool = (name: string) => {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};
const context = { origin: "https://take-studio.example", authorization: "Bearer tsk_x" };

describe("parity and coverage (AC-4)", () => {
  it("every flagged registry route has a tool and every tool has a flagged route", () => {
    const flagged = API_REGISTRY.filter((r) => r.mcp !== undefined);
    expect(TOOLS.map((t) => routeKey(t.route)).sort()).toEqual(flagged.map(routeKey).sort());
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it("every wired handler is a flagged route and every tool has a handler", () => {
    expect(Object.keys(handlers).sort()).toEqual(TOOLS.map((t) => routeKey(t.route)).sort());
  });

  it("every public route is a tool or is left out with a reason", () => {
    const left = new Set(MCP_EXCLUSIONS.map((e) => `${e.method} ${e.path}`));
    for (const route of API_REGISTRY) {
      const key = routeKey(route);
      expect(route.mcp !== undefined || left.has(key), key).toBe(true);
      expect(route.mcp !== undefined && left.has(key), `${key} is both`).toBe(false);
    }
    for (const exclusion of MCP_EXCLUSIONS) {
      expect(exclusion.note.length).toBeGreaterThan(20);
      expect(
        API_REGISTRY.some((r) => routeKey(r) === `${exclusion.method} ${exclusion.path}`),
      ).toBe(true);
    }
  });

  it("every tool has a plain description and an object input schema", () => {
    for (const t of TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(z.toJSONSchema(z.object(t.input)).type, t.name).toBe("object");
    }
  });

  it("every path part of a route is a field of the tool's input", () => {
    for (const t of TOOLS) {
      for (const part of t.route.path.matchAll(/\{(\w+)\}/g)) {
        const key = part[1] === "id" ? "takeId" : (part[1] ?? "");
        expect(Object.keys(t.input), `${t.name} ${key}`).toContain(key);
      }
    }
  });

  it("no tool takes a creator ID", () => {
    for (const t of TOOLS) {
      expect(
        Object.keys(t.input).filter((k) => /creator/i.test(k)),
        t.name,
      ).toEqual([]);
    }
  });
});

describe("annotations (AC-7)", () => {
  it("a GET route is read only, every other tool changes state", () => {
    for (const t of TOOLS) {
      expect(t.annotations.readOnlyHint, t.name).toBe(t.route.method === "GET");
    }
  });

  it("only the deleting tools are destructive", () => {
    expect(
      TOOLS.filter((t) => t.annotations.destructiveHint)
        .map((t) => t.name)
        .sort(),
    ).toEqual(["abort_upload", "delete_take"]);
  });

  it("the state changing tools the spec names are never read only", () => {
    for (const name of ["abort_upload", "apply_changes", "change_background", "delete_take"]) {
      expect(tool(name).annotations.readOnlyHint, name).toBe(false);
    }
  });

  it("only delete_take asks for confirmation", () => {
    expect(TOOLS.filter((t) => t.confirm).map((t) => t.name)).toEqual(["delete_take"]);
    expect(Object.keys(tool("delete_take").input)).toContain("confirm");
  });
});

describe("the request a tool builds (AC-3)", () => {
  it("puts path parts in the URL, encoded, and the caller's own header", async () => {
    const request = buildRouteRequest(tool("get_job"), { takeId: "a/b", jobId: "j 1" }, context);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/takes/a%2Fb/jobs/j%201");
    expect(request.headers.get("authorization")).toBe("Bearer tsk_x");
  });

  it("sends query fields on a GET and JSON on the others", async () => {
    const list = buildRouteRequest(tool("list_takes"), { cursor: "abc" }, context);
    expect(new URL(list.url).search).toBe("?cursor=abc");
    const rename = buildRouteRequest(tool("rename_take"), { takeId: "t1", title: "New" }, context);
    expect(rename.method).toBe("PATCH");
    expect(await rename.json()).toEqual({ title: "New" });
    const retry = buildRouteRequest(tool("retry_take"), { takeId: "t1" }, context);
    expect(retry.body).toBeNull();
  });

  it("sends a path index and format without putting them in the body", async () => {
    const undo = buildRouteRequest(
      tool("undo_ai_fix"),
      { takeId: "t1", index: 3, undone: true },
      context,
    );
    expect(new URL(undo.url).pathname).toBe("/api/takes/t1/transcript/edits/3");
    expect(await undo.json()).toEqual({ undone: true });
  });
});

describe("the delete guard (AC-7)", () => {
  it("does not call the route without confirm true", async () => {
    let called = 0;
    const spy = {
      [routeKey(tool("delete_take").route)]: async () => {
        called += 1;
        return new Response("{}");
      },
    };
    for (const input of [
      { takeId: "t1" },
      { takeId: "t1", confirm: false },
      { takeId: "t1", confirm: "true" },
    ]) {
      const outcome = await callTool(tool("delete_take"), input, spy, context);
      expect(outcome.isError).toBe(true);
      expect(JSON.parse(outcome.text).error).toBe("confirmation_required");
      expect(JSON.parse(outcome.text).message).toMatch(/ask the creator/i);
    }
    expect(called).toBe(0);
    const ok = await callTool(tool("delete_take"), { takeId: "t1", confirm: true }, spy, context);
    expect(called).toBe(1);
    expect(ok.isError).toBe(false);
  });
});
