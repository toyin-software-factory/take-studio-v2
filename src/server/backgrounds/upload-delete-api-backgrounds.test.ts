import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { background, processingJob, storageDeletion } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { backgroundKeys } from "@/lib/background-rules";
import type { UploadPorts } from "./upload";
import {
  type UploadHttpDeps,
  handleCompleteBackground,
  handleCreateBackground,
  handleDeleteBackground,
} from "./upload-http";
import { GOOD, ORIGIN, req, type Calls } from "./upload-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());
function setup(
  creatorId: string | null,
  options: { stored?: boolean; failTrigger?: boolean; failPresign?: boolean } = {},
) {
  const calls: Calls = { signed: [], ingested: [], drains: 0 };
  const deps: UploadHttpDeps = {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    ports: (database): UploadPorts => ({
      db: database,
      presignPut: async (key, contentType, bytes) => {
        if (options.failPresign) throw new Error("r2 down");
        calls.signed.push({ key, contentType, bytes });
        return `https://r2.test/${key}?X-Amz-Expires=900`;
      },
      headObject: async () => (options.stored === false ? null : { size: 1000 }),
      triggerIngest: async (id) => {
        if (options.failTrigger) throw new Error("trigger down");
        calls.ingested.push(id);
      },
    }),
    requestDrain: async () => void (calls.drains += 1),
  };
  return { deps, calls };
}
const create = (s: ReturnType<typeof setup>, body: unknown = GOOD) =>
  handleCreateBackground(req("POST", body), s.deps);
async function uploaded(creatorId: string) {
  const res = await create(setup(creatorId));
  return (await res.json()).id as string;
}
const complete = (s: ReturnType<typeof setup>, id: string) =>
  handleCompleteBackground(req("POST"), id, s.deps);
async function readyOne(creatorId: string) {
  const id = await uploaded(creatorId);
  await complete(setup(creatorId), id);
  const k = backgroundKeys(creatorId, id);
  await db
    .update(background)
    .set({ status: "ready", imageKey: k.imageKey, thumbKey: k.thumbKey, width: 1920, height: 1080 })
    .where(eq(background.id, id));
  return { id, keys: k };
}
const remove = (s: ReturnType<typeof setup>, id: string) =>
  handleDeleteBackground(req("DELETE"), id, s.deps);
describe("DELETE /api/backgrounds/{id}", () => {
  it("answers 204, removes the row, queues the files and asks for a drain", async () => {
    const creator = await createCreator(db);
    const { id, keys } = await readyOne(creator.id);
    const s = setup(creator.id);
    const res = await remove(s, id);
    expect(res.status).toBe(204);
    expect(s.calls.drains).toBe(1);
    expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(0);
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    expect(queued).toEqual(expect.arrayContaining([keys.sourceKey, keys.imageKey, keys.thumbKey]));
  });

  it("keeps an unfinished upload hidden while its upload link could be live, queueing its files now", async () => {
    const creator = await createCreator(db);
    const id = await uploaded(creator.id); // still `uploading`, link just handed out
    const res = await remove(setup(creator.id), id);
    expect(res.status).toBe(204);
    const [row] = await db.select().from(background).where(eq(background.id, id));
    expect(row).toMatchObject({ status: "failed", failureCode: "removed" });
    const queued = (await db.select().from(storageDeletion)).map((r) => r.objectKey);
    expect(queued).toContain(backgroundKeys(creator.id, id).sourceKey);
    // A removed upload cannot be completed.
    expect((await complete(setup(creator.id), id)).status).toBe(409);
  });

  it("answers 404 for another creator's and a built in background, deleting nothing (AC-9)", async () => {
    const creator = await createCreator(db);
    const other = await createCreator(db);
    const theirs = await readyOne(other.id);
    const builtIn = crypto.randomUUID();
    await db.insert(background).values({
      id: builtIn,
      creatorId: null,
      name: "Built in",
      status: "ready",
      imageKey: "b/i.jpg",
      thumbKey: "b/t.webp",
      width: 1920,
      height: 1080,
    });
    for (const id of [theirs.id, builtIn, "nope"]) {
      expect((await remove(setup(creator.id), id)).status).toBe(404);
    }
    expect(await db.select().from(background).where(eq(background.id, theirs.id))).toHaveLength(1);
    expect(await db.select().from(background).where(eq(background.id, builtIn))).toHaveLength(1);
    await db.delete(background).where(eq(background.id, builtIn));
  });

  it("answers 409 In use while a job renders with it", async () => {
    const creator = await createCreator(db);
    const { id } = await readyOne(creator.id);
    const t = await seedTake(db, creator.id, { status: "ready" });
    await db.insert(processingJob).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "background",
      status: "running",
      secondsCharged: 0,
      targetBackgroundId: id,
    });
    const res = await remove(setup(creator.id), id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "in_use",
      message: "In use, try again in a minute.",
    });
    expect(await db.select().from(background).where(eq(background.id, id))).toHaveLength(1);
  });

  it("checks Origin and session", async () => {
    const creator = await createCreator(db);
    const { id } = await readyOne(creator.id);
    expect(
      (await handleDeleteBackground(req("DELETE", undefined, null), id, setup(creator.id).deps))
        .status,
    ).toBe(403);
    expect((await handleDeleteBackground(req("DELETE"), id, setup(null).deps)).status).toBe(401);
  });
});
