/**
 * Transcript checks for the pipeline run (spec 0007 build plan step 6): tiny synthetic speech
 * fixtures against real Deepgram. AC-1 (Ready first, then the transcript, 0 charged, take
 * untouched), AC-6 (not English), AC-7 (no speech, no audio stream), AC-2 and AC-4 (the SRT lands
 * on the trimmed video within one frame), AC-9 (refusals), AC-10 (expired and deleted takes).
 * Called from run.ts with its helpers, so the services and the creators are shared.
 */
import { spawnSync } from "node:child_process";
import { and, asc, eq } from "drizzle-orm";
import { expireDueTakes } from "../../src/db/data/cleanup";
import { finish, startTranscribeJob } from "../../src/db/data/jobs";
import * as schema from "../../src/db/schema";
import { deleteTake } from "../../src/server/takes";
import { type Creator, db } from "./harness";

type TakeLike = {
  take: { status: string; expired?: boolean };
  latestRender: { id: string; durationMs: number | null } | null;
};

export type Ctx = {
  /** The creator of the earlier fixtures (the no audio take is theirs). */
  readonly a: Creator;
  /** A fresh creator for the transcript takes: the upload limit is 10 per hour per creator. */
  readonly t: Creator;
  readonly b: Creator;
  readonly check: (scenario: string, name: string, ok: boolean, detail?: unknown) => void;
  readonly upload: (creator: Creator, file: string, container: "mp4" | "mov") => Promise<string>;
  readonly waitFinal: (creator: Creator, takeId: string) => Promise<TakeLike>;
  readonly downloadRender: (creator: Creator, takeId: string) => Promise<string>;
  readonly media: (file: string) => string;
  /** The take ID of the existing "silent" fixture (a video with no audio stream), if it ran. */
  readonly noAudioTakeId: string | undefined;
};

type View = {
  state: string;
  reason?: string;
  canMake: boolean;
  version?: string;
  paragraphs?: {
    startMs: number;
    words: { w: string; startMs: number; endMs: number; filler: boolean }[];
  }[];
};

const FRAME_MS = 1000 / 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function view(c: Creator, takeId: string): Promise<View & { status: number }> {
  const res = await c.api("GET", `/api/takes/${takeId}/transcript`);
  return { status: res.status, ...(res.json as unknown as View) };
}

/** Polls the transcript every 2 s until it is no longer none or making. */
async function waitTranscript(c: Creator, takeId: string): Promise<View & { status: number }> {
  let last = await view(c, takeId);
  for (let i = 0; i < 90 && (last.state === "none" || last.state === "making"); i++) {
    await sleep(2_000);
    last = await view(c, takeId);
  }
  return last;
}

/** `silence_end` times (s) of the audio: when each stretch of sound begins. */
function onsets(path: string): number[] {
  const log = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      path,
      "-vn",
      "-af",
      "silencedetect=noise=-35dB:d=0.3",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 64 << 20 },
  ).stderr;
  return [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
}

/** Cue start times (ms) of an SRT file. */
function srtStarts(srt: string): number[] {
  return [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> /g)].map(
    (m) => ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]),
  );
}

const jobsOf = (takeId: string) =>
  db
    .select()
    .from(schema.processingJob)
    .where(eq(schema.processingJob.takeId, takeId))
    .orderBy(asc(schema.processingJob.createdAt));

const rowsOf = (takeId: string) =>
  db.select().from(schema.transcript).where(eq(schema.transcript.takeId, takeId));

export async function transcriptScenarios(ctx: Ctx): Promise<void> {
  const { b, check } = ctx;
  const a = ctx.t;
  const S = "transcript";
  let english: string | undefined;

  // English with a pause: AC-1, AC-2, AC-4.
  try {
    english = await ctx.upload(a, "speech-en.mp4", "mp4");
    const t = await ctx.waitFinal(a, english);
    check(S, "English: take Ready", t.take.status === "ready", t.take.status);
    const v = await waitTranscript(a, english);
    check(S, "English: transcript ready", v.state === "ready", {
      state: v.state,
      reason: v.reason,
    });
    const jobs = await jobsOf(english);
    const initial = jobs.find((j) => j.kind === "initial");
    // S5A-T01: the transcript is made inside the initial run (a step before the render), so
    // there is no separate transcribe job unless that step failed.
    const [transcriptStep] = initial
      ? await db
          .select()
          .from(schema.jobStep)
          .where(and(eq(schema.jobStep.jobId, initial.id), eq(schema.jobStep.name, "transcript")))
      : [];
    const saved = await rowsOf(english);
    check(
      S,
      "AC-1: the initial job's transcript step succeeded, no transcribe job (charge unchanged, no refund)",
      jobs.length === 1 &&
        initial?.status === "succeeded" &&
        initial.secondsCharged > 0 &&
        initial.refunded === false &&
        transcriptStep?.status === "succeeded" &&
        saved.length === 1,
      {
        jobs: jobs.map((j) => ({ kind: j.kind, status: j.status, charged: j.secondsCharged })),
        step: transcriptStep?.status,
        saved: saved.length,
      },
    );
    const [row] = await db.select().from(schema.take).where(eq(schema.take.id, english));
    check(S, "AC-1: the take is Ready with its transcript", row?.status === "ready", row?.status);

    const text = (v.paragraphs ?? [])
      .flatMap((p) => p.words.map((w) => w.w))
      .join(" ")
      .toLowerCase();
    check(
      S,
      "English: the words are there",
      text.includes("test") && text.includes("transcript"),
      text.slice(0, 80),
    );

    // AC-2 / AC-4: the SRT lands on the trimmed video within one frame.
    const [stored] = await rowsOf(english);
    const words = stored?.words ?? [];
    const flat = (v.paragraphs ?? []).flatMap((p) => p.words);
    let k = -1;
    for (let i = 1; i < words.length; i++) {
      if (words[i]!.startMs - words[i - 1]!.endMs > 1_500) k = i; // the word after the pause
    }
    check(S, "English: the pause sits between two words", k > 0, { words: words.length });
    check(S, "English: no word was lost to the trim", flat.length === words.length, {
      kept: flat.length,
      stored: words.length,
    });
    check(S, "English: a render was made", t.latestRender !== null, t.latestRender);
    // The render's own record of what was cut: there must be a cut, and the word measured
    // below must come after it, or the alignment checks would prove nothing.
    const [latest] = await db
      .select()
      .from(schema.render)
      .where(and(eq(schema.render.takeId, english), eq(schema.render.isLatest, true)));
    const cutsMade = latest?.removedRanges ?? [];
    check(S, "English: the render removed something", cutsMade.length > 0, cutsMade);
    check(
      S,
      "English: the measured word comes after a cut",
      k > 0 && cutsMade.some((r) => r.endMs <= words[k]!.startMs),
      { wordMs: words[k]?.startMs, cuts: cutsMade },
    );
    if (k > 0 && flat.length === words.length && t.latestRender) {
      const render = await ctx.downloadRender(a, english);
      const orig = onsets(ctx.media("speech-en.mp4"));
      const trimmed = onsets(render);
      const origOnset = orig[orig.length - 1]! * 1000;
      const renderOnset = trimmed[trimmed.length - 1]! * 1000;
      // Without a real trim both timelines are the same and the checks below would pass by
      // themselves: the 2.5 s pause must be visibly shorter in the render.
      check(
        S,
        "English: the pause was shortened in the render (by at least 1.5 s)",
        origOnset - renderOnset >= 1_500,
        {
          originalOnsetMs: Math.round(origOnset),
          renderOnsetMs: Math.round(renderOnset),
        },
      );
      // Deepgram's own lead or lag of the word against the sound is the same before and after
      // the trim, so what is left is the mapping onto the trimmed video.
      const jitter = words[k]!.startMs - origOnset;
      const mapped = flat[k]!.startMs - renderOnset;
      check(
        S,
        "AC-2: word time on the trimmed video within one frame of the render's sound",
        Math.abs(mapped - jitter) <= FRAME_MS + 2,
        {
          mappedMs: Math.round(mapped),
          jitterMs: Math.round(jitter),
        },
      );
      const srt = await a.raw("GET", `/api/takes/${english}/transcript/srt`);
      // Captions leave fillers out, so the cue starts on the first word that is not one.
      const caption = flat.slice(k).find((w) => !w.filler) ?? flat[k]!;
      const near = srtStarts(srt.text).some((s) => Math.abs(s - caption.startMs) <= FRAME_MS + 2);
      check(
        S,
        "AC-4: an SRT cue starts on that word within one frame",
        srt.status === 200 && near,
        {
          status: srt.status,
          cues: srtStarts(srt.text),
          wordMs: Math.round(caption.startMs),
        },
      );
    }
    for (const [format, type] of [
      ["txt", "text/plain"],
      ["srt", "application/x-subrip"],
      ["vtt", "text/vtt"],
    ] as const) {
      const r = await a.raw("GET", `/api/takes/${english}/transcript/${format}`);
      check(
        S,
        `AC-4: ${format} download`,
        r.status === 200 &&
          (r.headers.get("content-type") ?? "").startsWith(type) &&
          r.text.length > 10,
        { status: r.status, type: r.headers.get("content-type") },
      );
    }

    // AC-9 refusals and AC-11 ownership.
    const again = await a.api("POST", `/api/takes/${english}/transcript`);
    check(
      S,
      "AC-9: Make transcript refused once it exists (409 already_done)",
      again.status === 409 && again.json.error === "already_done",
      again,
    );
    const other = await b.api("GET", `/api/takes/${english}/transcript`);
    const otherPost = await b.api("POST", `/api/takes/${english}/transcript`);
    const otherDownload = await b.raw("GET", `/api/takes/${english}/transcript/srt`);
    check(
      S,
      "AC-11: another creator gets 404 on every transcript route",
      [other.status, otherPost.status, otherDownload.status].every((s) => s === 404),
      [other.status, otherPost.status, otherDownload.status],
    );
  } catch (error) {
    check(S, "English ran", false, String(error));
  }

  // Not English: AC-6.
  try {
    const es = await ctx.upload(a, "speech-es.mp4", "mp4");
    const t = await ctx.waitFinal(a, es);
    const v = await waitTranscript(a, es);
    check(
      S,
      "AC-6: Spanish take stays Ready, transcript skipped not_english",
      t.take.status === "ready" && v.state === "skipped" && v.reason === "not_english",
      { status: t.take.status, state: v.state, reason: v.reason },
    );
    check(S, "AC-6: no transcript stored", (await rowsOf(es)).length === 0, "");
    const dl = await a.raw("GET", `/api/takes/${es}/transcript/txt`);
    check(S, "AC-6: nothing to download (404)", dl.status === 404, dl.status);
  } catch (error) {
    check(S, "Spanish ran", false, String(error));
  }

  // No speech: AC-7, a silent audio track (Deepgram answers with no words) and no audio stream.
  let quiet: string | undefined;
  try {
    quiet = await ctx.upload(a, "speech-quiet.mp4", "mp4");
    await ctx.waitFinal(a, quiet);
    const v = await waitTranscript(a, quiet);
    check(
      S,
      "AC-7: silent audio track skipped no_speech",
      v.state === "skipped" && v.reason === "no_speech",
      { state: v.state, reason: v.reason },
    );
    if (ctx.noAudioTakeId) {
      const n = await waitTranscript(ctx.a, ctx.noAudioTakeId);
      check(
        S,
        "AC-7: a take with no audio stream skipped no_speech",
        n.state === "skipped" && n.reason === "no_speech",
        { state: n.state, reason: n.reason },
      );
    }
  } catch (error) {
    check(S, "No speech ran", false, String(error));
  }

  // Expired takes: AC-10.
  try {
    if (quiet) {
      // Expiry waits for an active transcribe job, then goes through.
      const started = await startTranscribeJob(db, { takeId: quiet });
      check(
        S,
        "AC-10: a transcribe job can start on a take that is about to expire",
        started.ok,
        started,
      );
      const past = new Date(Date.now() - 60_000);
      await db.update(schema.take).set({ videoExpiresAt: past }).where(eq(schema.take.id, quiet));
      await expireDueTakes(db, new Date());
      const [waiting] = await db.select().from(schema.take).where(eq(schema.take.id, quiet));
      check(
        S,
        "AC-10: expiry waits while the transcribe job is active",
        waiting?.status === "ready",
        waiting?.status,
      );
      if (started.ok) await finish(db, { jobId: started.data.id, status: "succeeded" });
      await expireDueTakes(db, new Date());
      const [done] = await db.select().from(schema.take).where(eq(schema.take.id, quiet));
      check(
        S,
        "AC-10: it expires on the next sweep once the job ended",
        done?.status === "expired",
        done?.status,
      );
    }
    if (english) {
      await db
        .update(schema.take)
        .set({ videoExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.take.id, english));
      await expireDueTakes(db, new Date());
      const [row] = await db.select().from(schema.take).where(eq(schema.take.id, english));
      check(S, "AC-10: the English take expired", row?.status === "expired", row?.status);
      const v = await view(a, english);
      check(
        S,
        "AC-10: the transcript is still shown, Make transcript hidden",
        v.state === "ready" && (v.paragraphs?.length ?? 0) > 0 && v.canMake === false,
        { state: v.state, canMake: v.canMake },
      );
      const srt = await a.raw("GET", `/api/takes/${english}/transcript/srt`);
      const txt = await a.raw("GET", `/api/takes/${english}/transcript/txt`);
      check(
        S,
        "AC-10: downloads still work on an expired take",
        srt.status === 200 && txt.status === 200,
        [srt.status, txt.status],
      );
      const make = await a.api("POST", `/api/takes/${english}/transcript`);
      check(S, "AC-10: Make transcript refused on an expired take", make.status === 409, make);
    }
  } catch (error) {
    check(S, "Expiry ran", false, String(error));
  }

  // Deleted take: AC-10.
  try {
    const doomed = await ctx.upload(a, "speech-en.mp4", "mp4");
    await ctx.waitFinal(a, doomed);
    const v = await waitTranscript(a, doomed);
    check(
      S,
      "deleted take: the transcript exists first",
      v.state === "ready" && (await rowsOf(doomed)).length === 1,
      v.state,
    );
    const deleted = await deleteTake(db, a.id, doomed, {
      cancelRuns: async () => {},
      requestStorageDrain: async () => {},
    });
    check(
      S,
      "AC-10: deleting the take deletes its transcript",
      deleted.ok && (await rowsOf(doomed)).length === 0,
      deleted.ok,
    );
    check(S, "deleted take: the route says 404", (await view(a, doomed)).status === 404, "");
  } catch (error) {
    check(S, "Deleted take ran", false, String(error));
  }
}
