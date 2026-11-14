import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertTranscript } from "@/db/data/transcripts";
import { analyticsEvent, render } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import type { TranscriptWord } from "@/lib/transcript-rules";
import { start } from "../jobs";
import { type TranscriptHttpDeps, handleTranscriptDownload } from "./http";
import { getTrimmedForCreator } from ".";

const ORIGIN = "https://take-studio.example";
const SECRET = "x".repeat(40);
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

const w = (
  word: string,
  startMs: number,
  endMs: number,
  extra: Partial<TranscriptWord> = {},
): TranscriptWord => ({
  w: word,
  startMs,
  endMs,
  conf: 0.99,
  filler: false,
  para: false,
  ...extra,
});

// 20 s take; 3 s to 5.5 s is removed; "lost" is spoken inside the cut.
const WORDS: TranscriptWord[] = [
  w("Um,", 300, 500, { para: true, filler: true }),
  w("Before", 500, 1000),
  w("the", 1000, 1200),
  w("pause.", 1200, 2800),
  w("lost", 3500, 4500),
  w("After", 5600, 6100, { para: true }),
  w("it.", 6100, 6600),
];

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

const get = (creatorId: string | null, takeId: string, format: string, query = "") =>
  handleTranscriptDownload(
    new Request(`${ORIGIN}/api/takes/${takeId}/transcript/${format}${query}`),
    takeId,
    format,
    deps(creatorId),
  );

describe("GET /api/takes/{id}/transcript/{format}", () => {
  it("sends the text on the trimmed timeline without fillers, as an attachment named from the title", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const res = await get(creator.id, t.id, "txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Before the pause.\n\nAfter it.\n");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="My interview.txt"; filename*=UTF-8''My%20interview.txt`,
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sends SRT cues on the trimmed video: words after the cut move up by the removed time", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const res = await get(creator.id, t.id, "srt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-subrip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    // "After" was at 5.6 s. At 25 fps the next kept start 5.5 s snaps down to the frame at 5.48 s, the same
    // as the render, so the word lands at 3.0 + (5.6 - 5.48) = 3.12 s on the trimmed video.
    expect(await res.text()).toBe(
      "1\n00:00:00,500 --> 00:00:02,800\nBefore the pause.\n\n" +
        "2\n00:00:03,120 --> 00:00:04,120\nAfter it.\n\n",
    );
  });

  it("sends WebVTT inline with the same cues", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const res = await get(creator.id, t.id, "vtt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/vtt");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(await res.text()).toBe(
      "WEBVTT\n\n00:00:00.500 --> 00:00:02.800\nBefore the pause.\n\n" +
        "00:00:03.120 --> 00:00:04.120\nAfter it.\n\n",
    );
  });

  it("sends cues on the original's own timeline with ?timeline=original (the cut review preview)", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const res = await get(creator.id, t.id, "vtt", "?timeline=original");
    expect(res.status).toBe(200);
    // Nothing is taken out: "After" stays at its recorded 5.6 s.
    expect(await res.text()).toContain("00:00:05.600 -->");
  });

  it("keeps the whole transcript when there is no render (a take handed back uncut)", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id, { ranges: null });
    const res = await get(creator.id, t.id, "txt");
    expect(await res.text()).toBe("Before the pause. lost\n\nAfter it.\n");
  });

  it("still works on an expired take: the transcript outlives the video (AC-10)", async () => {
    const creator = await createCreator(db);
    // An expired take no longer has its render or cuts applied; the transcript still reads.
    const t = await seed(creator.id, {
      ranges: null,
      take: { status: "expired", videoExpiresAt: new Date(Date.now() - 86_400_000) },
    });
    expect((await get(creator.id, t.id, "txt")).status).toBe(200);
    expect((await get(creator.id, t.id, "srt")).status).toBe(200);
  });

  it("names the file after a title with spaces and accents safely", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id, { title: "Café: part 1/2" });
    const res = await get(creator.id, t.id, "srt");
    const header = res.headers.get("content-disposition") ?? "";
    expect(header).toContain('filename="Cafe_ part 1_2.srt"');
    expect(header).toContain("filename*=UTF-8''Caf%C3%A9_%20part%201_2.srt");
  });

  it("answers 401 without a session", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    const res = await get(null, t.id, "txt");
    expect(res.status).toBe(401);
  });

  it("answers 404, with the usual body, for another creator's take", async () => {
    const owner = await createCreator(db);
    const other = await createCreator(db);
    const t = await seed(owner.id);
    for (const format of ["txt", "srt", "vtt"]) {
      const res = await get(other.id, t.id, format);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
  });

  it("answers 404 for a take with no transcript and for a malformed id", async () => {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id);
    expect((await get(creator.id, t.id, "txt")).status).toBe(404);
    expect((await get(creator.id, "not-a-uuid", "txt")).status).toBe(404);
  });

  it("answers 404 when no kept word is left: every word cut, or only fillers", async () => {
    const creator = await createCreator(db);
    const allCut = await seed(creator.id, { ranges: [{ startMs: 0, endMs: 20_000 }] });
    const onlyFillers = await seed(creator.id, {
      words: [w("um", 100, 300, { para: true, filler: true })],
    });
    for (const t of [allCut, onlyFillers]) {
      for (const format of ["txt", "srt", "vtt"]) {
        expect((await get(creator.id, t.id, format)).status).toBe(404);
      }
    }
  });

  it("answers 422 for any other format, after the ownership check", async () => {
    const owner = await createCreator(db);
    const other = await createCreator(db);
    const t = await seed(owner.id);
    for (const format of ["pdf", "TXT", "srt.txt", ""]) {
      const res = await get(owner.id, t.id, format);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("invalid_format");
    }
    // Another creator cannot tell from a bad format that the take exists.
    expect((await get(other.id, t.id, "pdf")).status).toBe(404);
  });

  it("records transcript_downloaded with the format, and nothing for a refused one (spec 0016 AC-5)", async () => {
    const creator = await createCreator(db);
    const t = await seed(creator.id);
    for (const format of ["txt", "srt", "vtt", "pdf"]) await get(creator.id, t.id, format);
    const rows = await db
      .select()
      .from(analyticsEvent)
      .where(
        and(
          eq(analyticsEvent.creatorId, creator.id),
          eq(analyticsEvent.name, "transcript_downloaded"),
        ),
      );
    expect(rows.map((r) => r.props)).toEqual([
      { kind: "transcript_txt" },
      { kind: "transcript_srt" },
      { kind: "transcript_vtt" },
    ]);
  });

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
