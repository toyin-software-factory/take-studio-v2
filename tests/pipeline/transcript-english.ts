/** English with a pause (AC-1, AC-2, AC-4). Called from transcript.ts. */
import { and, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { db } from "./harness";
import {
  type Ctx,
  FRAME_MS,
  jobsOf,
  onsets,
  rowsOf,
  srtStarts,
  waitTranscript,
} from "./transcript-env";

export async function englishScenarios(ctx: Ctx): Promise<string | undefined> {
  const { b, check } = ctx;
  const a = ctx.t;
  const S = "transcript";
  let english: string | undefined;
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
  return english;
}
