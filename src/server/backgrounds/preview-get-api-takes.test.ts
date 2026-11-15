import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completePreview } from "@/db/data/previews";
import { background, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { BackgroundPreview, Db } from "@/db/types";
import { type PreviewHttpDeps, handleGetPreview } from "./preview-http";
import { ORIGIN, ask, built } from "./preview-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_preview_get_api_takes" });
  db = testDb.db;
});
afterAll(async () => {
  if (testDb) await built.clean(testDb.db);
  await testDb?.close();
});
function deps(creatorId: string | null, triggered: BackgroundPreview[] = [], failTrigger = false) {
  const value: PreviewHttpDeps = {
    allowedOrigin: ORIGIN,
    getCreator: async () => (creatorId ? { db, creatorId } : null),
    triggerPreview: async (preview) => {
      if (failTrigger) throw new Error("trigger down");
      triggered.push(preview);
      return { id: "run" };
    },
    presignGet: async (key, { expiresSeconds }) =>
      `https://r2.test/${key}?expires=${expiresSeconds}`,
  };
  return value;
}
async function read(d: PreviewHttpDeps, takeId: string, backgroundId: string) {
  const res = await handleGetPreview(
    new Request(`https://x.test/api/takes/x/background/preview?backgroundId=${backgroundId}`),
    takeId,
    d,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
async function seedBackground(over: Partial<typeof background.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(background)
    .values({
      id,
      creatorId: null,
      name: "Studio",
      imageKey: `backgrounds/builtin/${id}.jpg`,
      thumbKey: `backgrounds/builtin/${id}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
      ...over,
    })
    .returning();
  return built.track(row!);
}
async function readyTake() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
  return { creator, take: t };
}
describe("GET /api/takes/[id]/background/preview", () => {
  it("reads the preview: 404 before any ask, then making, then ready with a link", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    expect((await read(deps(creator.id), t.id, bg.id)).status).toBe(404);
    const triggered: BackgroundPreview[] = [];
    await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    expect((await read(deps(creator.id), t.id, bg.id)).json).toEqual({
      state: "making",
      noGreenScreen: false,
    });
    await completePreview(db, { previewId: triggered[0]!.id, noGreenScreen: false });
    const ready = await read(deps(creator.id), t.id, bg.id);
    expect(ready.status).toBe(200);
    expect(ready.json).toMatchObject({ state: "ready", noGreenScreen: false });
    expect(String(ready.json.url)).toContain(`previews/${t.id}/`);
  });

  it("is session and owner only, and needs a good backgroundId", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    await ask(deps(creator.id), t.id, { backgroundId: bg.id });
    expect((await read(deps(null), t.id, bg.id)).status).toBe(401);
    const stranger = await createCreator(db);
    expect((await read(deps(stranger.id), t.id, bg.id)).status).toBe(404);
    expect((await read(deps(creator.id), t.id, "not-a-uuid")).status).toBe(422);
  });

  it("answers 409 original_gone for the still of an expired take (its file is being deleted)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const triggered: BackgroundPreview[] = [];
    await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    await completePreview(db, { previewId: triggered[0]!.id, noGreenScreen: false });
    expect((await read(deps(creator.id), t.id, bg.id)).status).toBe(200);
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, t.id));
    const gone = await read(deps(creator.id), t.id, bg.id);
    expect([gone.status, gone.json.error]).toEqual([409, "original_gone"]);
    expect(gone.json.url).toBeUndefined();
  });

  it("shows a failed preview as failed", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    await ask(deps(creator.id, [], true), t.id, { backgroundId: bg.id });
    expect((await read(deps(creator.id), t.id, bg.id)).json).toEqual({
      state: "failed",
      noGreenScreen: false,
    });
  });
});
