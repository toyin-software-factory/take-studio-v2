import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertTranscript } from "@/db/data/transcripts";
import { render } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import type { TranscriptWord } from "@/lib/transcript-rules";
import { start } from "../jobs";
import { type TranscriptHttpDeps, handleTranscriptDownload } from "./http";
import { getTrimmedForCreator } from ".";
import { ORIGIN, SECRET, WORDS } from "./routes-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());
const deps = (creatorId: string | null): TranscriptHttpDeps => ({
  allowedOrigin: ORIGIN,
  getCreator: async () => (creatorId ? { db, creatorId } : null),
});
async function seed(
  creatorId: string,
  options: {
    title?: string;
    words?: TranscriptWord[];
    ranges?: { startMs: number; endMs: number }[] | null;
    take?: Parameters<typeof seedTake>[2];
  } = {},
) {
  const t = await seedTake(db, creatorId, {
    title: options.title ?? "My interview",
    durationMs: 20_000,
    ...options.take,
  });
  if (options.ranges !== null) {
    const job = await start(db, { creatorId, takeId: t.id, usageSecret: SECRET });
    if (!job.ok) throw new Error(job.error);
    await db.insert(render).values({
      id: crypto.randomUUID(),
      takeId: t.id,
      jobId: job.data.id,
      status: "succeeded",
      videoKey: `renders/${t.id}/r.mp4`,
      durationMs: 17_500,
      removedRanges: options.ranges ?? [{ startMs: 3000, endMs: 5500 }],
      isLatest: true,
    });
  }
  const saved = await upsertTranscript(db, {
    takeId: t.id,
    language: "en",
    text: "full text",
    words: options.words ?? WORDS,
    sourceFps: 25,
    model: "nova-3",
  });
  if (!saved.ok) throw new Error(saved.error);
  return t;
}
describe("GET /api/takes/{id}/transcript/{format}", () => {
  it("does not need an Origin header (a read)", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const res = await handleTranscriptDownload(
      new Request(`${ORIGIN}/x`, { headers: { origin: "https://evil.example" } }),
      t.id,
      "txt",
      deps(creator.id),
    );
    expect(res.status).toBe(200);
  });
});
describe("getTrimmedForCreator", () => {
  it("returns trimmed paragraphs (fillers kept for the panel) and a version", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const view = await getTrimmedForCreator(db, creator.id, t.id);
    if (!view.ok) throw new Error("expected a transcript");
    expect(view.data.title).toBe("My interview");
    expect(view.data.paragraphs.map((p) => [p.startMs, p.words.map((x) => x.w)])).toEqual([
      [300, ["Um,", "Before", "the", "pause."]],
      [3120, ["After", "it."]],
    ]);
    expect(view.data.paragraphs[0]?.words[0]?.filler).toBe(true);
  });

  it("changes version when the transcript is replaced or a new render lands", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const first = await getTrimmedForCreator(db, creator.id, t.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await upsertTranscript(db, {
      takeId: t.id,
      language: "en",
      text: "again",
      words: WORDS,
      sourceFps: 25,
      model: "nova-3",
    });
    const second = await getTrimmedForCreator(db, creator.id, t.id);
    if (!first.ok || !second.ok) throw new Error("expected transcripts");
    expect(second.data.version).not.toBe(first.data.version);
  });
});
