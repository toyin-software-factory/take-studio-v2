import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Imported at the top, not inside the test: the cold import of the Better Auth route is slow under load
// and used to eat the 5 s test timeout.
import * as route from "@/app/api/auth/[...all]/route";
import { appSetting, usageMonth } from "@/db/schema";
import { createApiKey } from "@/db/data/api-keys";
import { type TestDb, createCreator, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-rules";
import { chargedMonth } from "@/lib/billing";
import { usageAccountHash } from "@/lib/usage-hash";
import type { ApiAuthDeps } from "./api-auth";
import type { UploadDeps } from "./uploads";
import { type HttpDeps, handleCreate } from "./uploads/http";
import { handleUsage } from "./usage/http";
import { NOW, ORIGIN, SECRET, req, type Caller, type Via } from "./api-parity-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_api_parity_3" });
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
