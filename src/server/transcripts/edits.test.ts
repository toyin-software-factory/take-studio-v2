import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setTranscriptEdits, upsertTranscript } from "@/db/data/transcripts";
import { transcript } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import type { TranscriptEdit, TranscriptWord } from "@/lib/transcript-rules";
import {
  type TranscriptHttpDeps,
  handleGetTranscript,
  handlePatchEdit,
  handleTranscriptDownload,
} from "./http";

const ORIGIN = "https://take-studio.example";
const NOT_FOUND = { error: "not_found", message: "We couldn't find that take." };

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

const w = (word: string, startMs: number, endMs: number): TranscriptWord => ({
  w: word,
  startMs,
  endMs,
  conf: 0.99,
  filler: false,
  para: startMs === 0,
});
const WORDS = [w("Hi", 0, 400), w("Jon", 400, 900), w("here.", 900, 1500)];
const FIX: TranscriptEdit = {
  index: 1,
  old: "Jon",
  new: "John",
  reason: "Name",
  undone: false,
};

async function seed(creatorId: string, edits: readonly TranscriptEdit[] = [FIX]) {
  const t = await seedTake(db, creatorId, { title: "Chat", durationMs: 5000 });
  const saved = await upsertTranscript(db, {
    takeId: t.id,
    language: "en",
    text: "Hi Jon here.",
    words: WORDS,
    sourceFps: 25,
    model: "nova-3",
  });
  if (!saved.ok) throw new Error(saved.error);
  await setTranscriptEdits(db, t.id, edits);
  return t;
}

const patch = (
  creatorId: string | null,
  takeId: string,
  index: string,
  body: unknown,
  origin: string | null = ORIGIN,
) =>
  handlePatchEdit(
    new Request(`${ORIGIN}/api/takes/${takeId}/transcript/edits/${index}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    takeId,
    index,
    deps(creatorId),
  );
const download = (creatorId: string, takeId: string, format: string) =>
  handleTranscriptDownload(
    new Request(`${ORIGIN}/api/takes/${takeId}/transcript/${format}`),
    takeId,
    format,
    deps(creatorId),
  );
const view = async (creatorId: string, takeId: string) =>
  (
    await handleGetTranscript(
      new Request(`${ORIGIN}/api/takes/${takeId}/transcript`),
      takeId,
      deps(creatorId),
    )
  ).json();

describe("transcript fixes (spec 0012, AC-4, AC-11)", () => {
  it("shows the fix in the GET (edits and the fixed word with its index) and every export", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const body = await view(creator.id, t.id);
    expect(body.edits).toEqual([FIX]);
    expect(
      body.paragraphs[0].words.map((x: { w: string; index: number }) => [x.index, x.w]),
    ).toEqual([
      [0, "Hi"],
      [1, "John"],
      [2, "here."],
    ]);
    expect(await (await download(creator.id, t.id, "txt")).text()).toBe("Hi John here.\n");
    expect(await (await download(creator.id, t.id, "srt")).text()).toContain("Hi John here.");
    expect(await (await download(creator.id, t.id, "vtt")).text()).toContain("Hi John here.");
    // The stored text and words are never rewritten.
    const [row] = await db.select().from(transcript).where(eq(transcript.takeId, t.id));
    expect(row?.text).toBe("Hi Jon here.");
    expect(row?.words[1]?.w).toBe("Jon");
  });

  it("undo changes the SRT and the version, redo changes them back", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const before = (await view(creator.id, t.id)).version;
    const undone = await patch(creator.id, t.id, "1", { undone: true });
    expect(undone.status).toBe(200);
    const undoneBody = await undone.json();
    expect(undoneBody.edit).toEqual({ ...FIX, undone: true });
    expect(undoneBody.version).not.toBe(before);
    expect(await (await download(creator.id, t.id, "srt")).text()).toContain("Hi Jon here.");
    expect((await view(creator.id, t.id)).version).toBe(undoneBody.version);

    const redone = await patch(creator.id, t.id, "1", { undone: false });
    expect((await redone.json()).edit.undone).toBe(false);
    expect(await (await download(creator.id, t.id, "srt")).text()).toContain("Hi John here.");
  });

  it("answers 403 for a bad or missing Origin, before anything else", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    expect(
      (await patch(creator.id, t.id, "1", { undone: true }, "https://evil.example")).status,
    ).toBe(403);
    expect((await patch(creator.id, t.id, "1", { undone: true }, null)).status).toBe(403);
    expect((await view(creator.id, t.id)).edits[0].undone).toBe(false);
  });

  it("answers 401 without a session", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    expect((await patch(null, t.id, "1", { undone: true })).status).toBe(401);
  });

  it("answers 404 for another creator's take, and changes nothing", async () => {
    const owner = await createCreator(db);
    const other = await createCreator(db);
    const t = await seed(owner.id);
    const res = await patch(other.id, t.id, "1", { undone: true });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect((await view(owner.id, t.id)).edits[0].undone).toBe(false);
  });

  it("answers 404 for an index with no fix, a malformed index or id, and a take with no transcript", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    for (const index of ["0", "2", "99", "-1", "1.5", "abc", "01"]) {
      expect((await patch(creator.id, t.id, index, { undone: true })).status).toBe(404);
    }
    expect((await patch(creator.id, "not-a-uuid", "1", { undone: true })).status).toBe(404);
    const bare = await seedTake(db, creator.id, { durationMs: 5000 });
    expect((await patch(creator.id, bare.id, "1", { undone: true })).status).toBe(404);
  });

  it("answers 422 for a bad body", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    for (const body of [{}, { undone: "yes" }, { undone: true, extra: 1 }, "nope", "null"]) {
      expect((await patch(creator.id, t.id, "1", body)).status).toBe(422);
    }
  });

  it("keeps the other fixes when one is undone", async () => {
    const creator = await createCreator(db);
    const second: TranscriptEdit = { ...FIX, index: 2, old: "here.", new: "here!", reason: "p" };
    const t = await seed(creator.id, [FIX, second]);
    await patch(creator.id, t.id, "1", { undone: true });
    const edits = (await view(creator.id, t.id)).edits as TranscriptEdit[];
    expect(edits.map((e) => [e.index, e.undone])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it("a new transcript replaces the words and drops the old fixes", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    await upsertTranscript(db, {
      takeId: t.id,
      language: "en",
      text: "x",
      words: WORDS,
      sourceFps: 25,
      model: "nova-3",
    });
    expect((await view(creator.id, t.id)).edits).toEqual([]);
  });
});
