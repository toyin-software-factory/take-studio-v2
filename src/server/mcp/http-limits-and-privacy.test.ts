import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import { type McpHttpDeps, handleMcp } from "./http";
import { testMcpDeps } from "./test-wiring";
import { ORIGIN, call, json, rpc, toolText } from "./http-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_mcp_2" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
afterEach(() => vi.restoreAllMocks());
const deps = (): McpHttpDeps => testMcpDeps(db);
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
describe("limits and privacy (AC-10, AC-11)", () => {
  it("counts every POST: the 121st in a minute is 429 with Retry-After, tools/list included", async () => {
    const { key } = await newCaller();
    for (let i = 0; i < 60; i += 1) expect((await post(rpc("ping"), key)).status).toBe(200);
    for (let i = 0; i < 60; i += 1) expect((await post(rpc("tools/list"), key)).status).toBe(200);
    const refused = await post(rpc("ping"), key);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  }, 60_000);

  it("logs the tool, take, creator, status and duration and nothing else", async () => {
    const a = await newCaller();
    const take = await seedTake(db, a.creatorId, { title: "Secret title" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await post(call("list_takes"), a.key);
    await post(call("list_takes", { cursor: "!!" }), a.key);
    await post(rpc("ping"), "tsk_wrong_key_value");
    const lines = info.mock.calls.filter((c) => c[0] === "mcp_call");
    expect(lines).toHaveLength(2);
    for (const [, fields] of lines) {
      expect(Object.keys(fields as object).sort()).toEqual([
        "creatorId",
        "durationMs",
        "status",
        "takeId",
        "tool",
      ]);
    }
    expect(lines[0]?.[1]).toMatchObject({
      tool: "list_takes",
      creatorId: a.creatorId,
      status: 200,
    });
    expect(lines[1]?.[1]).toMatchObject({ status: 400 });
    const everything = JSON.stringify([info.mock.calls, warn.mock.calls, log.mock.calls]);
    for (const secret of [a.key, "Secret title", take.id, "!!", "tsk_wrong_key_value"]) {
      expect(everything).not.toContain(secret);
    }
  });
  it("a route that throws answers a fixed message, logs one line and hides the error text", async () => {
    const a = await newCaller();
    const secret =
      "Failed query: select * from take where title = 'Secret title' params: tsk_secret";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const real = deps();
    const throwing: McpHttpDeps = {
      ...real,
      handlers: {
        ...real.handlers,
        "GET /api/takes": async () => {
          throw new Error(secret);
        },
      },
    };
    const res = await handleMcp(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${a.key}` },
        body: JSON.stringify(call("list_takes")),
      }),
      throwing,
    );
    const out = toolText(await json(res));
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.text)).toEqual({
      error: "internal",
      message: "Something went wrong on our side. Try again in a moment.",
    });
    expect(out.text).not.toContain("Secret title");
    const lines = info.mock.calls.filter((c) => c[0] === "mcp_call");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[1]).toMatchObject({
      tool: "list_takes",
      creatorId: a.creatorId,
      status: 500,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("Secret title");
  });
});
