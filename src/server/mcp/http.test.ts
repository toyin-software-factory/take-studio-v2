import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiKey, revokeApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import { MCP, MCP_TOOL_NAMES } from "@/lib/mcp-rules";
import { type McpHttpDeps, handleMcp } from "./http";
import { testMcpDeps } from "./test-wiring";
import { TOOLS } from "./tools";
import { ORIGIN, call, json, rpc, toolText } from "./http-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_mcp" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
afterEach(() => vi.restoreAllMocks());
const deps = (): McpHttpDeps => testMcpDeps(db);
const routeHandlers = (): McpHttpDeps["handlers"] => deps().handlers;
async function newCaller(): Promise<{ creatorId: string; key: string; keyId: string }> {
  const creator = await createCreator(db);
  const key = generateApiKey();
  const made = await createApiKey(db, {
    creatorId: creator.id,
    name: "agent",
    prefix: apiKeyPrefix(key),
    keyHash: await hashApiKey(key),
  });
  if (!made.ok) throw new Error("no key");
  return { creatorId: creator.id, key, keyId: made.data.id };
}
const post = (body: unknown, key?: string, extra: Record<string, string> = {}) =>
  handleMcp(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...extra,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    deps(),
  );
describe("transport (AC-1)", () => {
  it("initializes: negotiated version, server name and instructions", async () => {
    const { key } = await newCaller();
    const response = await post(
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      key,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const reply = await json(response);
    expect(reply.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: MCP.serverName },
    });
    expect(String(reply.result?.instructions)).toContain("Ask the creator before");
  });

  it("answers 202 to the initialized notification and {} to ping", async () => {
    const { key } = await newCaller();
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, key)).status).toBe(
      202,
    );
    expect((await json(await post(rpc("ping"), key))).result).toEqual({});
  });

  it("lists the tools with annotations and a JSON Schema input", async () => {
    const { key } = await newCaller();
    const reply = await json(await post(rpc("tools/list"), key));
    const tools = (reply.result?.tools ?? []) as {
      name: string;
      annotations: Record<string, boolean>;
      inputSchema: { type: string };
    }[];
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations).toMatchObject(
        TOOLS.find((t) => t.name === tool.name)?.annotations ?? {},
      );
    }
  });

  it("every registered tool is in the name list and the other way round", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  it("answers -32601 for an unknown method", async () => {
    const { key } = await newCaller();
    expect((await json(await post(rpc("resources/list"), key))).error?.code).toBe(-32601);
  });

  it("refuses a batch, an oversized body and bad JSON", async () => {
    const { key } = await newCaller();
    const batch = await post([rpc("ping")], key);
    expect(batch.status).toBe(400);
    expect((await json(batch)).error?.code).toBe(-32600);
    const big = await post(JSON.stringify({ pad: "x".repeat(MCP.maxBodyBytes) }), key);
    expect(big.status).toBe(413);
    const declared = await post(rpc("ping"), key, {
      "content-length": String(MCP.maxBodyBytes + 1),
    });
    expect(declared.status).toBe(413);
    const bad = await post("{nope", key);
    expect(bad.status).toBe(400);
    expect((await json(bad)).error?.code).toBe(-32700);
  });

  it("stops reading a stream with no Content-Length at the limit", async () => {
    const { key } = await newCaller();
    let pulled = 0;
    const chunk = new Uint8Array(65_536).fill(120);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const response = await handleMcp(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit),
      deps(),
    );
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });

  it("answers 405 to GET and DELETE", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await handleMcp(new Request(`${ORIGIN}/mcp`, { method }), deps());
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });
});
describe("identity (AC-2)", () => {
  it("is 401 with the metadata link for no header, a bad key and a revoked key", async () => {
    const { key, keyId, creatorId } = await newCaller();
    const link = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;
    for (const response of [
      await post(rpc("ping")),
      await post(rpc("ping"), "tsk_not_a_real_key"),
    ]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(link);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect((await post(rpc("ping"), key)).status).toBe(200);
    expect((await revokeApiKey(db, creatorId, keyId)).ok).toBe(true);
    const revoked = await post(rpc("ping"), key);
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toBe(link);
  });

  it("never reads a cookie: a session with no header is still 401", async () => {
    const response = await handleMcp(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "better-auth.session_token=abc" },
        body: JSON.stringify(rpc("ping")),
      }),
      deps(),
    );
    expect(response.status).toBe(401);
  });
});
describe("tools are the routes (AC-3, AC-9)", () => {
  it("get_usage gives the status and body of GET /api/usage", async () => {
    const { key } = await newCaller();
    const direct = await routeHandlers()["GET /api/usage"]?.(
      new Request(`${ORIGIN}/api/usage`, { headers: { authorization: `Bearer ${key}` } }),
      {},
    );
    if (!direct) throw new Error("no handler");
    const viaMcp = toolText(await json(await post(call("get_usage"), key)));
    expect(direct.status).toBe(200);
    expect(viaMcp.isError).toBe(false);
    expect(JSON.parse(viaMcp.text)).toEqual(await direct.json());
  });

  it("list_takes lists the caller's takes only, and pages with a cursor", async () => {
    const a = await newCaller();
    const b = await newCaller();
    const mine = await seedTake(db, a.creatorId, { title: "Mine" });
    const theirs = await seedTake(db, b.creatorId, { title: "Theirs" });
    const body = JSON.parse(toolText(await json(await post(call("list_takes"), a.key))).text) as {
      takes: { id: string }[];
    };
    const ids = body.takes.map((t) => t.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    const direct = await routeHandlers()["GET /api/takes"]?.(
      new Request(`${ORIGIN}/api/takes`, { headers: { authorization: `Bearer ${a.key}` } }),
      {},
    );
    if (!direct) throw new Error("no handler");
    expect(body).toEqual(await direct.json());
  });

  it("shows the route's own error as an isError result", async () => {
    const { key } = await newCaller();
    const bad = toolText(await json(await post(call("list_takes", { cursor: "!!" }), key)));
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.text)).toMatchObject({ error: "invalid_cursor" });
  });

  it("refuses an unknown tool and bad input without calling a route", async () => {
    const { key } = await newCaller();
    const unknown = await json(await post(call("delete_take", { takeId: "x" }), key));
    expect(unknown.error ?? unknown.result?.isError).toBeTruthy();
    const badInput = await json(await post(call("list_takes", { cursor: 5 }), key));
    expect(badInput.error ?? badInput.result?.isError).toBeTruthy();
  });
});
