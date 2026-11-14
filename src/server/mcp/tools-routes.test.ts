import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import { routeKey } from "@/lib/api-registry";
import { buildRouteRequest, callTool, pathParams } from "./dispatch";
import { buildHandlers } from "./handlers";
import { TEST_ORIGIN, testRouteDeps } from "./test-deps";
import { TOOLS } from "./tools";

/**
 * Spec 0019 AC-3 (a tool and its route answer the same), AC-7 (the delete guard end to end) and
 * AC-9 (a key reaches only its own creator's takes), with the real route handlers over a real
 * test database. Own database so the rate windows stay out of other files.
 */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_mcp_tools" });
  db = testDb.db;
});
afterAll(() => testDb?.close());

type Who = { readonly creatorId: string; readonly authorization: string };
async function newCreator(): Promise<Who> {
  const creator = await createCreator(db);
  const key = generateApiKey();
  const made = await createApiKey(db, {
    creatorId: creator.id,
    name: "agent",
    prefix: apiKeyPrefix(key),
    keyHash: await hashApiKey(key),
  });
  if (!made.ok) throw new Error("no key");
  return { creatorId: creator.id, authorization: `Bearer ${key}` };
}

const handlers = () => buildHandlers(testRouteDeps(db));
const run = (name: string, input: Record<string, unknown>, who: Who) => {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return callTool(tool, input, handlers(), {
    origin: TEST_ORIGIN,
    authorization: who.authorization,
  });
};

const ANY_ID = "7d6f3f0e-8b1a-4b57-9c52-0a1b2c3d4e5f";

/** A valid input for every tool that names a take, aimed at the take `t`. */
const takeInputs = (t: string): Readonly<Record<string, Record<string, unknown>>> => ({
  get_take: { takeId: t },
  rename_take: { takeId: t, title: "Stolen" },
  delete_take: { takeId: t, confirm: true },
  get_upload_part_links: { takeId: t, partNumbers: [1] },
  complete_upload: { takeId: t, parts: [{ partNumber: 1, etag: "e" }] },
  abort_upload: { takeId: t },
  retry_take: { takeId: t },
  get_job: { takeId: t, jobId: ANY_ID },
  get_media_link: { takeId: t, kind: "original" },
  get_transcript: { takeId: t },
  make_transcript: { takeId: t },
  get_transcript_file: { takeId: t, format: "txt" },
  undo_ai_fix: { takeId: t, index: 0, undone: true },
  change_background: { takeId: t, backgroundId: ANY_ID },
  preview_background: { takeId: t, backgroundId: ANY_ID },
  get_background_preview: { takeId: t, backgroundId: ANY_ID },
  apply_changes: { takeId: t, baseRenderId: null },
  get_waveform: { takeId: t },
  mark_missed: { takeId: t, atMs: 1000 },
});

describe("ownership (AC-9)", () => {
  it("every tool that names a take gives creator A's key the route's 404 for creator B's take", async () => {
    const a = await newCreator();
    const b = await newCreator();
    const theirs = await seedTake(db, b.creatorId, { title: "Theirs" });
    const inputs = takeInputs(theirs.id);
    const named = TOOLS.filter((t) => "takeId" in t.input);
    expect(Object.keys(inputs).sort()).toEqual(named.map((t) => t.name).sort());
    for (const tool of named) {
      const outcome = await run(tool.name, inputs[tool.name] ?? {}, a);
      expect(outcome.isError, tool.name).toBe(true);
      expect(outcome.status, tool.name).toBe(404);
      expect(outcome.text, tool.name).not.toContain("Theirs");
    }
    const still = await run("get_take", { takeId: theirs.id }, b);
    expect(still.status).toBe(200);
    expect(still.text).toContain("Theirs");
  });

  it("the tools without a take ID show only the caller's own data", async () => {
    const a = await newCreator();
    const b = await newCreator();
    const mine = await seedTake(db, a.creatorId, { title: "Mine" });
    const theirs = await seedTake(db, b.creatorId, { title: "Theirs" });
    const list = await run("list_takes", {}, a);
    const ids = (JSON.parse(list.text) as { takes: { id: string }[] }).takes.map((t) => t.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect((await run("get_usage", {}, a)).status).toBe(200);
    expect((await run("list_backgrounds", {}, a)).status).toBe(200);
    const nobody = await run("list_takes", {}, { creatorId: "", authorization: "" });
    expect(nobody.status).toBe(401);
  });
});

describe("a tool and its route answer the same (AC-3)", () => {
  it("gives the route's status and body for reads and writes", async () => {
    const a = await newCreator();
    const take = await seedTake(db, a.creatorId, { title: "Same" });
    const cases: readonly (readonly [string, Record<string, unknown>])[] = [
      ["get_usage", {}],
      ["list_takes", {}],
      ["get_take", { takeId: take.id }],
      ["get_waveform", { takeId: take.id }],
      ["get_transcript", { takeId: take.id }],
      ["get_media_link", { takeId: take.id, kind: "original" }],
      ["get_job", { takeId: take.id, jobId: ANY_ID }],
      ["rename_take", { takeId: take.id, title: "Renamed" }],
      ["rename_take", { takeId: take.id, title: "" }],
      ["get_take", { takeId: ANY_ID }],
    ];
    for (const [name, input] of cases) {
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) throw new Error(name);
      const handler = handlers()[routeKey(tool.route)];
      if (!handler) throw new Error(name);
      const ctx = { origin: TEST_ORIGIN, authorization: a.authorization };
      const direct = await handler(buildRouteRequest(tool, input, ctx), pathParams(tool, input));
      const viaTool = await run(name, input, a);
      expect(viaTool.status, name).toBe(direct.status);
      expect(JSON.parse(viaTool.text), name).toEqual(await direct.json());
    }
  });
});

describe("delete_take (AC-7)", () => {
  it("keeps the take until the input says confirm true, then deletes it", async () => {
    const a = await newCreator();
    const take = await seedTake(db, a.creatorId, { title: "Doomed" });
    for (const input of [{ takeId: take.id }, { takeId: take.id, confirm: false }]) {
      const refused = await run("delete_take", input, a);
      expect(refused.isError).toBe(true);
      expect(JSON.parse(refused.text).error).toBe("confirmation_required");
    }
    expect((await run("get_take", { takeId: take.id }, a)).status).toBe(200);
    const done = await run("delete_take", { takeId: take.id, confirm: true }, a);
    expect(done.isError).toBe(false);
    expect((await run("get_take", { takeId: take.id }, a)).status).toBe(404);
  });
});
