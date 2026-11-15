import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finish } from "@/db/data/jobs";
import { take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { type MediaHttpDeps, handleMedia } from "../media";
import { start } from "../jobs";
import {
  type TakeHttpDeps,
  handleDelete,
  handleGet,
  handleList,
  handleRename,
  handleRetry,
} from "./http";
import { NOT_FOUND, ORIGIN, SECRET, req, type Signed } from "./routes-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());
function takeDeps(
  creatorId: string | null,
  triggered: string[] = [],
  failTrigger = false,
): TakeHttpDeps {
  return {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    usageSecret: () => SECRET,
    triggerProcessTake: async (jobId) => {
      if (failTrigger) throw new Error("trigger down");
      triggered.push(jobId);
      return { id: `run_${jobId}` };
    },
  };
}
function mediaDeps(creatorId: string | null, stored: Set<string> | "all" = "all") {
  const signed: Signed[] = [];
  const deps: MediaHttpDeps = {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    headObject: async (key) => (stored === "all" || stored.has(key) ? { size: 1 } : null),
    presignGet: async (key, { expiresSeconds, disposition }) => {
      signed.push({ key, expiresSeconds, ...disposition });
      return `https://r2.test/${key}?X-Amz-Expires=${expiresSeconds}`;
    },
  };
  return { deps, signed };
} /** A take that failed with `code` through the real job path (charged, then refunded if refundable). */
async function failedTake(
  creatorId: string,
  code: "internal_error" | "too_long" | "cancelled_while_running",
) {
  const t = await seedTake(db, creatorId, { status: "uploaded" });
  const job = await start(db, { creatorId, takeId: t.id, usageSecret: SECRET });
  if (!job.ok) throw new Error(job.error);
  const done = await finish(db, {
    jobId: job.data.id,
    status: code === "cancelled_while_running" ? "cancelled" : "failed",
    failureCode: code,
  });
  if (!done.ok) throw new Error(done.error);
  return t;
}
describe("session and Origin (spec 0004 API surface)", () => {
  it("answers 401 on every route when signed out", async () => {
    const id = crypto.randomUUID();
    for (const res of [
      await handleList(req("GET", "/api/takes"), takeDeps(null)),
      await handleGet(req("GET", `/api/takes/${id}`), id, takeDeps(null)),
      await handleRename(req("PATCH", `/api/takes/${id}`, { title: "x" }), id, takeDeps(null)),
      await handleRetry(req("POST", `/api/takes/${id}/retry`), id, takeDeps(null)),
      await handleDelete(req("DELETE", `/api/takes/${id}`), id, takeDeps(null)),
      await handleMedia(req("GET", `/api/takes/${id}/media?kind=play`), id, mediaDeps(null).deps),
    ]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("returns source and script on the take GET, and none for another creator (spec 0021)", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    await db.update(take).set({ source: "recording", script: "My line." }).where(eq(take.id, t.id));
    const res = await handleGet(req("GET", "/x"), t.id, takeDeps(creator.id));
    expect(((await res.json()) as { take: unknown }).take).toMatchObject({
      source: "recording",
      script: "My line.",
    });
    const plain = await seedTake(db, creator.id);
    const body = (await (
      await handleGet(req("GET", "/x"), plain.id, takeDeps(creator.id))
    ).json()) as { take: unknown };
    expect(body.take).toMatchObject({ source: "file", script: null });
    const other = await createCreator(db);
    const denied = await handleGet(req("GET", "/x"), t.id, takeDeps(other.id));
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain("My line.");
  });

  it("checks Origin on PATCH and POST only", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    const deps = takeDeps(creator.id);
    expect(
      (await handleRename(req("PATCH", "/x", { title: "y" }, "https://evil.example"), t.id, deps))
        .status,
    ).toBe(403);
    expect((await handleRetry(req("POST", "/x", undefined, null), t.id, deps)).status).toBe(403);
    expect((await handleGet(req("GET", "/x", undefined, null), t.id, deps)).status).toBe(200);
    expect((await handleList(req("GET", "/api/takes", undefined, null), deps)).status).toBe(200);
  });
});
describe("ownership (AC-11)", () => {
  it("gives another creator and a malformed ID the same 404 on every route, and changes nothing", async () => {
    const owner = await createCreator(db);
    const other = await createCreator(db);
    const t = await failedTake(owner.id, "internal_error");
    for (const id of [t.id, "not-a-uuid", crypto.randomUUID()]) {
      const responses = [
        await handleGet(req("GET", "/x"), id, takeDeps(other.id)),
        await handleRename(req("PATCH", "/x", { title: "Hijacked" }), id, takeDeps(other.id)),
        await handleRetry(req("POST", "/x"), id, takeDeps(other.id)),
        await handleDelete(req("DELETE", "/x"), id, takeDeps(other.id)),
        ...(await Promise.all(
          (["play", "download", "original"] as const).map((kind) =>
            handleMedia(req("GET", `/x?kind=${kind}`), id, mediaDeps(other.id).deps),
          ),
        )),
      ];
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual(NOT_FOUND);
      }
    }
    const [row] = await db.select().from(take).where(eq(take.id, t.id));
    expect(row?.title).toBe("Seeded take");
    expect(row?.status).toBe("failed");
  });

  it("lists only the creator's own takes", async () => {
    const a = await createCreator(db);
    const b = await createCreator(db);
    await seedTake(db, a.id, { title: "A's take" });
    await seedTake(db, b.id, { title: "B's take" });
    const res = await handleList(req("GET", "/api/takes"), takeDeps(a.id));
    const body = (await res.json()) as { takes: { title: string }[] };
    expect(body.takes.map((card) => card.title)).toEqual(["A's take"]);
  });
});
describe("GET /api/takes (AC-1)", () => {
  it("pages 24 at a time, newest first, with a cursor", async () => {
    const creator = await createCreator(db);
    for (let i = 0; i < 30; i += 1) {
      await seedTake(db, creator.id, {
        title: `Take ${i}`,
        createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
      });
    }
    const first = (await (
      await handleList(req("GET", "/api/takes"), takeDeps(creator.id))
    ).json()) as {
      takes: { title: string }[];
      nextCursor: string | null;
    };
    expect(first.takes).toHaveLength(24);
    expect(first.takes[0]?.title).toBe("Take 29");
    expect(first.nextCursor).not.toBeNull();
    const second = (await (
      await handleList(
        req("GET", `/api/takes?cursor=${encodeURIComponent(first.nextCursor!)}`),
        takeDeps(creator.id),
      )
    ).json()) as { takes: { title: string }[]; nextCursor: string | null };
    expect(second.takes.map((t) => t.title)).toEqual([
      "Take 5",
      "Take 4",
      "Take 3",
      "Take 2",
      "Take 1",
      "Take 0",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor with 400", async () => {
    const creator = await createCreator(db);
    const res = await handleList(req("GET", "/api/takes?cursor=%%%"), takeDeps(creator.id));
    expect(res.status).toBe(400);
  });

  it("gives failed cards their code and whether they can be retried (AC-10)", async () => {
    const creator = await createCreator(db);
    await failedTake(creator.id, "internal_error");
    await failedTake(creator.id, "too_long");
    const body = (await (
      await handleList(req("GET", "/api/takes"), takeDeps(creator.id))
    ).json()) as {
      takes: { failureCode: string; retryable: boolean }[];
    };
    expect(body.takes.map((c) => [c.failureCode, c.retryable])).toEqual([
      ["too_long", false],
      ["internal_error", true],
    ]);
  });
});
