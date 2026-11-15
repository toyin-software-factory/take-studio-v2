import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { API_REGISTRY, routeKey } from "@/lib/api-registry";
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
import { NOW, ORIGIN, SECRET, req, type Caller, type Route } from "./api-parity-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_parity_4" });
  db = testDb.db;
});
afterAll(() =>
  testDb?.close(),
); /** The identity deps for one caller: a session lookup that knows only the session creator. */
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
]; /**
 * Registry routes the by session vs by key comparison above does not run: they need R2, Trigger.dev
 * or a multipart upload to answer. They go through the same shared guard as the rest (checked
 * below), so a key reaches them exactly as a session does. Listed here so a new registry route
 * must be run above or named here with a reason.
 */
const GUARD_CHECKED: Readonly<Record<string, string>> = {
  "POST /api/uploads": "needs R2 multipart",
  "POST /api/uploads/{takeId}/parts": "needs R2 multipart",
  "POST /api/uploads/{takeId}/complete": "needs R2 and Trigger.dev",
  "DELETE /api/uploads/{takeId}": "needs R2",
  "DELETE /api/takes/{id}": "queues R2 deletions",
  "POST /api/takes/{id}/retry": "needs Trigger.dev",
  "POST /api/takes/{id}/missed": "writes a product event",
  "PUT /api/takes/{id}/background": "needs Trigger.dev",
  "GET /api/takes/{id}/background/preview": "needs R2",
  "POST /api/takes/{id}/background/preview": "needs Trigger.dev",
  "PATCH /api/takes/{id}/transcript/edits/{index}": "needs the transcript fixture",
  "POST /api/backgrounds": "needs R2",
  "POST /api/backgrounds/{id}/complete": "needs R2 and Trigger.dev",
  "DELETE /api/backgrounds/{id}": "needs R2",
};
describe("every registry route is compared or guard checked (AC-7, AC-8)", () => {
  const compared = new Set(ROUTES.map((r) => r.name));

  it("names every registry route in the comparison or in the guard checked list", () => {
    const missing = API_REGISTRY.map(routeKey).filter(
      (k) => !compared.has(k) && !(k in GUARD_CHECKED),
    );
    expect(missing).toEqual([]);
  });

  it("lists no route twice and none that is not in the registry", () => {
    const keys = new Set(API_REGISTRY.map(routeKey));
    for (const name of compared) expect(keys.has(name)).toBe(true);
    for (const name of Object.keys(GUARD_CHECKED)) {
      expect(keys.has(name)).toBe(true);
      expect(compared.has(name)).toBe(false);
    }
  });

  it("has every route handler file take its creator from the shared guard", () => {
    const files = [
      "uploads/http.ts",
      "takes/http.ts",
      "takes/missed.ts",
      "backgrounds/http.ts",
      "backgrounds/upload-http.ts",
      "backgrounds/library-http.ts",
      "backgrounds/preview-http.ts",
      "changes/http.ts",
      "transcripts/http.ts",
      "email/prefs-http.ts",
      "usage/http.ts",
      "media/index.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(/\b(guard|resolveCreator)\(/.test(source), file).toBe(true);
    }
  });
});
