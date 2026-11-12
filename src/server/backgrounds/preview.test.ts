import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PREVIEW_STALE_MS } from "@/lib/background-preview";
import { completePreview } from "@/db/data/previews";
import { background, backgroundPreview, cut, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { BackgroundPreview, Db } from "@/db/types";
import { type PreviewHttpDeps, handleGetPreview, handlePostPreview } from "./preview-http";

const ORIGIN = "https://take-studio.example";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

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

const post = (body: unknown, origin: string | null = ORIGIN) =>
  new Request("https://x.test/api/takes/x/background/preview", {
    method: "POST",
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function ask(
  d: PreviewHttpDeps,
  takeId: string,
  body: unknown,
  origin: string | null = ORIGIN,
) {
  const res = await handlePostPreview(post(body, origin), takeId, d);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
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
  return row!;
}

async function readyTake() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
  return { creator, take: t };
}

describe("POST /api/takes/[id]/background/preview (AC-4)", () => {
  it("starts a preview (202 making), triggers the job once, and a second ask only waits", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const triggered: BackgroundPreview[] = [];
    const first = await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    expect([first.status, first.json.state]).toEqual([202, "making"]);
    expect(first.json.url).toBeUndefined();
    const second = await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    expect([second.status, second.json.state]).toEqual([202, "making"]);
    // One job for the take: the second ask found the first still being made.
    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toMatchObject({ takeId: t.id, backgroundId: bg.id });
  });

  it("answers a cache hit at once with a one hour link and the no green screen flag", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const triggered: BackgroundPreview[] = [];
    await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    await completePreview(db, { previewId: triggered[0]!.id, noGreenScreen: true });
    const hit = await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    expect(hit.status).toBe(200);
    expect(hit.json).toEqual({
      state: "ready",
      url: `https://r2.test/previews/${t.id}/${triggered[0]!.id}.jpg?expires=3600`,
      noGreenScreen: true,
    });
    expect(triggered).toHaveLength(1);
  });

  it("makes a new preview when the cuts change", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const triggered: BackgroundPreview[] = [];
    await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    await completePreview(db, { previewId: triggered[0]!.id, noGreenScreen: false });
    await db.insert(cut).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "pause",
      proposedBy: "rules",
      startMs: 1000,
      endMs: 2500,
      applied: true,
      reason: "Pause",
    });
    const again = await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    expect([again.status, again.json.state]).toEqual([202, "making"]);
    expect(triggered).toHaveLength(2);
    expect(triggered[1]!.id).not.toBe(triggered[0]!.id);
  });

  it("checks Origin (403), the session (401) and the body (422) in that order", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    expect((await ask(deps(creator.id), t.id, { backgroundId: bg.id }, null)).status).toBe(403);
    expect(
      (await ask(deps(creator.id), t.id, { backgroundId: bg.id }, "https://evil.example")).status,
    ).toBe(403);
    expect((await ask(deps(null), t.id, { backgroundId: bg.id })).status).toBe(401);
    for (const bad of [{}, { backgroundId: "original" }, { backgroundId: 5 }, null]) {
      expect((await ask(deps(creator.id), t.id, bad)).status).toBe(422);
    }
    expect(
      await db.select().from(backgroundPreview).where(eq(backgroundPreview.takeId, t.id)),
    ).toHaveLength(0);
  });

  it("answers 404 for another creator's take or background, and a bad ID", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const stranger = await createCreator(db);
    expect((await ask(deps(stranger.id), t.id, { backgroundId: bg.id })).status).toBe(404);
    expect((await ask(deps(creator.id), "nope", { backgroundId: bg.id })).status).toBe(404);
    const theirs = await seedBackground({ creatorId: stranger.id });
    expect((await ask(deps(creator.id), t.id, { backgroundId: theirs.id })).status).toBe(404);
    expect((await ask(deps(creator.id), t.id, { backgroundId: crypto.randomUUID() })).status).toBe(
      404,
    );
  });

  it("refuses with 409: expired original, take not ready, background not ready", async () => {
    const bg = await seedBackground();
    const pending = await seedBackground({
      status: "processing",
      imageKey: null,
      thumbKey: null,
      width: null,
      height: null,
    });
    const { creator, take: t } = await readyTake();
    const notReady = await ask(deps(creator.id), t.id, { backgroundId: pending.id });
    expect([notReady.status, notReady.json.error]).toEqual([409, "background_not_ready"]);
    const processing = await seedTake(db, creator.id, { status: "processing" });
    const busy = await ask(deps(creator.id), processing.id, { backgroundId: bg.id });
    expect([busy.status, busy.json.error]).toEqual([409, "not_ready"]);
    const old = await readyTake();
    await db
      .update(take)
      .set({ videoExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(take.id, old.take.id));
    const gone = await ask(deps(old.creator.id), old.take.id, { backgroundId: bg.id });
    expect([gone.status, gone.json.error]).toEqual([409, "original_gone"]);
  });

  it("marks the preview failed and answers 503 when the trigger throws, so the next ask starts it again", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const res = await ask(deps(creator.id, [], true), t.id, { backgroundId: bg.id });
    expect(res.status).toBe(503);
    const [row] = await db
      .select()
      .from(backgroundPreview)
      .where(eq(backgroundPreview.takeId, t.id));
    expect(row?.status).toBe("failed");
    const triggered: BackgroundPreview[] = [];
    const again = await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    expect([again.status, again.json.state]).toEqual([202, "making"]);
    expect(triggered).toHaveLength(1);
  });

  it("triggers no second run while the first may still be running (past the old 2 minutes)", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const triggered: BackgroundPreview[] = [];
    await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    // 5 minutes in: the job may be on its second attempt. The ask is answered, nothing starts.
    const soon = { ...deps(creator.id, triggered), now: () => new Date(Date.now() + 5 * 60_000) };
    const res = await ask(soon, t.id, { backgroundId: bg.id });
    expect(res.status).toBe(202);
    expect(triggered).toHaveLength(1);
  });

  it("starts a stale making preview again, on the same row", async () => {
    const bg = await seedBackground();
    const { creator, take: t } = await readyTake();
    const triggered: BackgroundPreview[] = [];
    await ask(deps(creator.id, triggered), t.id, { backgroundId: bg.id });
    const later = new Date(Date.now() + PREVIEW_STALE_MS + 60_000);
    const stale = { ...deps(creator.id, triggered), now: () => later };
    const res = await ask(stale, t.id, { backgroundId: bg.id });
    expect(res.status).toBe(202);
    expect(triggered).toHaveLength(2);
    expect(triggered[1]!.id).toBe(triggered[0]!.id);
  });
});

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
