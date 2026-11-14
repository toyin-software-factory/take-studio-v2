import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appSetting, usageMonth } from "@/db/schema";
import { createApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import { API_REGISTRY, routeKey } from "@/lib/api-registry";
import { chargedMonth } from "@/lib/billing";
import { usageAccountHash } from "@/lib/usage-hash";
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
import type { UploadDeps } from "./uploads";
import { type HttpDeps, handleCreate } from "./uploads/http";
import { handleUsage } from "./usage/http";

/**
 * Spec 0018 step 4 (AC-7): every route of the registry gives the same answer by session and by
 * key, a key never reaches another creator's data, and the monthly allowance applies by key
 * exactly as by session. Real handlers, real test database. Own database: `app_setting` is global.
 */
const ORIGIN = "https://take-studio.example";
const SECRET = "x".repeat(40);
const NOW = new Date("2026-11-10T12:00:00Z");
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_parity" });
  db = testDb.db;
});
afterAll(() => testDb?.close());

type Via = "session" | "key";
type Caller = { readonly via: Via; readonly creatorId: string; readonly headers: Headers };

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
}

/** The identity deps for one caller: a session lookup that knows only the session creator. */
function identity(c: Caller): ApiAuthDeps {
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
});

type Ctx = { readonly c: Caller; readonly takeId: string };
type Route = {
  readonly name: string;
  readonly takeScoped: boolean;
  readonly run: (ctx: Ctx) => Promise<Response>;
};
const req = (c: Caller, path: string, method = "GET", body?: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: c.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** One entry per creator route of the registry (the session only ones are tested apart). */
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

/** Drops what legitimately differs between two runs: ids, timestamps and presigned links. */
function normalize(value: unknown, ids: readonly string[]): unknown {
  const text = JSON.stringify(value, (k, v) =>
    /(^|[a-z])(At|Url)$|^(id|jobId|takeId)$/.test(k) ? "<x>" : v,
  );
  return JSON.parse(ids.reduce((s, id) => s.split(id).join("<id>"), text));
}
async function answer(res: Response, ids: readonly string[]) {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // A text body (a transcript file) is compared as text.
  }
  return {
    status: res.status,
    cache: res.headers.get("cache-control"),
    body: normalize(body, ids),
  };
}

async function fresh(via: Via) {
  const creator = await createCreator(db);
  const take = await seedTake(db, creator.id, { status: "ready" });
  return { ctx: { c: await caller(via, creator.id), takeId: take.id }, creator, take };
}

describe("same answers by session and by key (AC-7)", () => {
  for (const route of ROUTES) {
    it(`${route.name}`, async () => {
      const a = await fresh("session");
      const b = await fresh("key");
      const bySession = await answer(await route.run(a.ctx), [a.take.id, a.creator.id]);
      const byKey = await answer(await route.run(b.ctx), [b.take.id, b.creator.id]);
      expect(byKey).toEqual(bySession);
      // Never a 401 for a valid key or session: the route really ran.
      expect(byKey.status).not.toBe(401);
    });
  }
});

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

describe("the monthly allowance applies by key (AC-7, spec 0014)", () => {
  async function setSettings(): Promise<void> {
    for (const row of [
      { key: "usage_limit_enabled", value: true },
      { key: "free_monthly_seconds", value: 100 },
    ]) {
      await db
        .insert(appSetting)
        .values(row)
        .onConflictDoUpdate({ target: appSetting.key, set: { value: row.value } });
    }
  }
  async function spentAccount(via: Via) {
    const creator = await createCreator(db);
    await db.insert(usageMonth).values({
      accountHash: await usageAccountHash(creator.email, SECRET),
      month: chargedMonth(NOW),
      secondsUsed: 100,
      hashVersion: 1,
    });
    return caller(via, creator.id);
  }
  const upload = (c: Caller) =>
    handleCreate(
      req(c, "/api/uploads", "POST", { fileName: "a.mp4", sizeBytes: 1000, container: "mp4" }),
      {
        ...identity(c),
        usageSecret: () => SECRET,
        now: () => NOW,
        uploadDeps: () => ({}) as UploadDeps,
      } satisfies HttpDeps,
    );

  it("refuses a spent allowance with the same limit_exceeded body as the session", async () => {
    await setSettings();
    const bySession = await upload(await spentAccount("session"));
    const byKey = await upload(await spentAccount("key"));
    expect(byKey.status).toBe(403);
    expect(byKey.status).toBe(bySession.status);
    const keyBody = await byKey.json();
    expect(keyBody).toMatchObject({ error: "limit_exceeded", remainingSeconds: 0 });
    expect(keyBody).toEqual(await bySession.json());
  });

  it("GET /api/usage shows the same numbers by key", async () => {
    await setSettings();
    const s = await spentAccount("session");
    const k = await spentAccount("key");
    const run = (c: Caller) =>
      handleUsage(req(c, "/api/usage"), {
        ...identity(c),
        usageSecret: () => SECRET,
        now: () => NOW,
      });
    expect(await (await run(k)).json()).toEqual(await (await run(s)).json());
  });
});

describe("no route builds its own identity check (AC-5)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(join(dir, e.name))
        : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
    );

  it("calls deps.getCreator and getSession only inside the shared guard and its deps", () => {
    const allowed = new Set(["api-auth.ts", "api-auth-deps.ts", "request.ts"]);
    const offenders = [...files("src/server"), ...files("src/app/api")].filter((f) => {
      if (allowed.has(f.split("/").pop() ?? "")) return false;
      const text = readFileSync(f, "utf8");
      return /deps\.getCreator\(|\bgetSession\(/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("every route's deps spread the shared apiAuthDeps", () => {
    const deps = files("src/server").filter((f) => /(^|\/)[\w-]*deps\.ts$/.test(f));
    const missing = deps.filter((f) => {
      const text = readFileSync(f, "utf8");
      return (
        /getCreator|allowedOrigin/.test(text) &&
        !/apiAuthDeps\(\)/.test(text) &&
        !f.endsWith("api-auth-deps.ts")
      );
    });
    expect(missing).toEqual([]);
  });
});

describe("Better Auth paths are session only (AC-4)", () => {
  it("answers 401 session_required to any bearer, before Better Auth runs", async () => {
    const route = await import("@/app/api/auth/[...all]/route");
    for (const [method, path] of [
      ["POST", "/api/auth/delete-user"],
      ["POST", "/api/auth/change-email"],
      ["POST", "/api/auth/change-password"],
      ["POST", "/api/auth/sign-out"],
    ] as const) {
      const res = await route.POST(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: { authorization: "Bearer tsk_whatever", cookie: "better-auth.session_token=x" },
        }),
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "session_required" });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});

/**
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
