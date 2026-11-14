import { describe, expect, it } from "vitest";
import { MCP, MCP_TOOL_NAMES, RPC_CODE, checkBody, wwwAuthenticate } from "./mcp-rules";

describe("checkBody (spec 0019 AC-1)", () => {
  it("lets one JSON object through", () => {
    const checked = checkBody('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    expect(checked).toEqual({ ok: true, message: { jsonrpc: "2.0", id: 1, method: "ping" } });
  });

  it("refuses a batch as an invalid request", () => {
    expect(checkBody('[{"jsonrpc":"2.0","id":1,"method":"ping"}]')).toMatchObject({
      ok: false,
      status: 400,
      code: RPC_CODE.invalidRequest,
    });
  });

  it("refuses a body over the cap with 413, counting bytes not characters", () => {
    const big = JSON.stringify({ text: "é".repeat(MCP.maxBodyBytes / 2) });
    expect(checkBody(big)).toMatchObject({ ok: false, status: 413 });
    const fits = JSON.stringify({ text: "x".repeat(1000) });
    expect(checkBody(fits).ok).toBe(true);
  });

  it("answers a parse error for text that is not JSON, and an invalid request for a scalar", () => {
    expect(checkBody("{nope")).toMatchObject({ ok: false, status: 400, code: RPC_CODE.parse });
    expect(checkBody("42")).toMatchObject({ ok: false, code: RPC_CODE.invalidRequest });
    expect(checkBody("null")).toMatchObject({ ok: false, code: RPC_CODE.invalidRequest });
  });
});

describe("wwwAuthenticate (AC-2)", () => {
  it("points at the protected resource metadata under the base URL", () => {
    expect(wwwAuthenticate("https://take.example/")).toBe(
      'Bearer resource_metadata="https://take.example/.well-known/oauth-protected-resource"',
    );
  });
});

describe("tool names", () => {
  it("are verbs in snake case with no duplicates", () => {
    expect(new Set(MCP_TOOL_NAMES).size).toBe(MCP_TOOL_NAMES.length);
    for (const name of MCP_TOOL_NAMES) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
  });
});
