import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import type { ApiAuthDeps } from "./api-auth";
import { handleListBackgrounds } from "./backgrounds/library-http";
import { handleChanges, handleJobStatus, handleWaveform } from "./changes/http";
import { handleGetPrefs, handleSetPrefs } from "./email/prefs-http";
import { handleMedia } from "./media";
import { handleGet, handleList, handleRename, type TakeHttpDeps } from "./takes/http";
import {
  handleGetTranscript,
  handleMakeTranscript,
  handleTranscriptDownload,
} from "./transcripts/http";
import { handleUsage } from "./usage/http";
import {
  NOW,
  ORIGIN,
  SECRET,
  answer,
  req,
  type Caller,
  type Route,
  type Via,
} from "./api-parity-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_parity_2" });
  db = testDb.db;
});
afterAll(() => testDb?.close());
async function caller(via: Via, creatorId: string): Promise<Caller> {
  const headers = new Headers({ "content-type": "application/json" });
  if (via === "session") {
    headers.set("origin", ORIGIN);
  } else {
    const key = generateApiKey();
    const made = await createApiKey(db, {
      creatorId,
      name: "agent",
      prefix: apiKeyPrefix(key),
      keyHash: await hashApiKey(key),
    });
    if (!made.ok) throw new Error("no key");
    headers.set("authorization", `Bearer ${key}`);
  }
  return { via, creatorId, headers };
} /** The identity deps for one caller: a session lookup that knows only the session creator. */
function identity(c: Caller): ApiAuthDeps & { readonly allowedOrigin: string } {
  return {
    allowedOrigin: ORIGIN,
    getCreator: async () => (c.via === "session" ? { db, creatorId: c.creatorId } : null),
    keyAuth: { getDb: async () => db, now: () => NOW },
  };
}
const takeDeps = (c: Caller): TakeHttpDeps => ({
  ...identity(c),
  usageSecret: () => SECRET,
  triggerProcessTake: async () => ({ id: "run" }),
  now: () => NOW,
});
const transcriptDeps = (c: Caller) => ({
  ...identity(c),
  triggerTranscribe: async () => ({ id: "run" }),
  now: () => NOW,
});
const mediaDeps = (c: Caller) => ({
  ...identity(c),
  headObject: async () => ({ size: 10 }),
  presignGet: async () => "https://r2.example/link",
  now: () => NOW,
}); /** One entry per creator route of the registry (the session only ones are tested apart). */
const ROUTES: readonly Route[] = [
  {
    name: "GET /api/usage",
    takeScoped: false,
    run: ({ c }) =>
      handleUsage(req(c, "/api/usage"), {
        ...identity(c),
        usageSecret: () => SECRET,
        now: () => NOW,
      }),
  },
  {
    name: "GET /api/takes",
    takeScoped: false,
    run: ({ c }) => handleList(req(c, "/api/takes"), takeDeps(c)),
  },
  {
    name: "GET /api/takes/{id}",
    takeScoped: true,
    run: ({ c, takeId }) => handleGet(req(c, `/api/takes/${takeId}`), takeId, takeDeps(c)),
  },
  {
    name: "PATCH /api/takes/{id}",
    takeScoped: true,
    run: ({ c, takeId }) =>
      handleRename(
        req(c, `/api/takes/${takeId}`, "PATCH", { title: "New title" }),
        takeId,
        takeDeps(c),
      ),
  },
  {
    name: "GET /api/takes/{id}/media",
    takeScoped: true,
    run: ({ c, takeId }) =>
      handleMedia(req(c, `/api/takes/${takeId}/media?kind=original`), takeId, mediaDeps(c)),
  },
  {
    name: "GET /api/takes/{id}/waveform",
    takeScoped: true,
    run: ({ c, takeId }) =>
      handleWaveform(req(c, `/api/takes/${takeId}/waveform`), takeId, takeDeps(c)),
  },
  {
    name: "GET /api/takes/{id}/jobs/{jobId}",
    takeScoped: true,
    run: ({ c, takeId }) =>
      handleJobStatus(req(c, `/api/takes/${takeId}/jobs/none`), takeId, "none", takeDeps(c)),
  },
  {
    name: "POST /api/takes/{id}/changes",
    takeScoped: true,
    run: ({ c, takeId }) =>
      handleChanges(
        req(c, `/api/takes/${takeId}/changes`, "POST", { baseRenderId: null, cuts: [] }),
        takeId,
        takeDeps(c),
      ),
  },
  {
    name: "GET /api/takes/{id}/transcript",
    takeScoped: true,
    run: ({ c, takeId }) =>
      handleGetTranscript(req(c, `/api/takes/${takeId}/transcript`), takeId, transcriptDeps(c)),
  },
  {
    name: "POST /api/takes/{id}/transcript",
    takeScoped: true,
    run: ({ c, takeId }) =>
      handleMakeTranscript(
        req(c, `/api/takes/${takeId}/transcript`, "POST"),
        takeId,
        transcriptDeps(c),
      ),
  },
  {
    name: "GET /api/takes/{id}/transcript/{format}",
    takeScoped: true,
    run: ({ c, takeId }) =>
      handleTranscriptDownload(
        req(c, `/api/takes/${takeId}/transcript/txt`),
        takeId,
        "txt",
        transcriptDeps(c),
      ),
  },
  {
    name: "GET /api/account/email-prefs",
    takeScoped: false,
    run: ({ c }) => handleGetPrefs(req(c, "/api/account/email-prefs"), identity(c)),
  },
  {
    name: "PATCH /api/account/email-prefs",
    takeScoped: false,
    run: ({ c }) =>
      handleSetPrefs(
        req(c, "/api/account/email-prefs", "PATCH", { takeEmails: false }),
        identity(c),
      ),
  },
  {
    name: "GET /api/backgrounds",
    takeScoped: false,
    run: ({ c }) =>
      handleListBackgrounds(req(c, "/api/backgrounds"), {
        ...identity(c),
        presignGet: async () => "https://r2.example/thumb",
      }),
  },
];
async function fresh(via: Via) {
  const creator = await createCreator(db);
  const take = await seedTake(db, creator.id, { status: "ready" });
  return { ctx: { c: await caller(via, creator.id), takeId: take.id }, creator, take };
}
describe("a key never reaches another creator's data (AC-7)", () => {
  for (const route of ROUTES.filter((r) => r.takeScoped)) {
    it(`${route.name} is 404 for a key of someone else, like the session`, async () => {
      const owner = await fresh("session");
      const other = await createCreator(db);
      const otherKey = await caller("key", other.id);
      const otherSession = await caller("session", other.id);
      const byKey = await answer(await route.run({ c: otherKey, takeId: owner.take.id }), [
        owner.take.id,
        other.id,
      ]);
      const bySession = await answer(await route.run({ c: otherSession, takeId: owner.take.id }), [
        owner.take.id,
        other.id,
      ]);
      expect(byKey.status).toBe(404);
      expect(byKey).toEqual(bySession);
    });
  }

  it("GET /api/takes lists only the key owner's takes", async () => {
    const mine = await fresh("key");
    const theirs = await fresh("key");
    const res = await handleList(req(mine.ctx.c, "/api/takes"), takeDeps(mine.ctx.c));
    const ids = (await res.json()).takes.map((t: { id: string }) => t.id);
    expect(ids).toContain(mine.take.id);
    expect(ids).not.toContain(theirs.take.id);
  });
});
