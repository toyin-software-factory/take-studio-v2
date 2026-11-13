import { ORIGINAL_INPUT } from "@/lib/ffmpeg-input";
import { reanalyse } from "@/db/data/cuts";
import { whileJobActive } from "@/db/data/jobs";
import { EDIT_DEADLINE_MS } from "@/lib/processing";
import {
  cutsFromSilences,
  parseSilences,
  silencedetectFilter,
  throttledProgress,
} from "@/lib/trim";
import { runFfmpeg } from "../media";
import { storeWaveform } from "../waveform";
import { prepareBackground } from "./background";
import { type RunContext, type RunResult, setStep } from "./context";
import { finishWithoutRender } from "./finish";
import { encode } from "./render";
import { ship } from "./ship";
import { transcriptStep } from "./transcript-step";
import { aiEditAlreadyFinal, aiEditStep, storedHasCuts } from "./ai-edit-step";

/**
 * The full run (an `initial` job, or a `rerender` of a failed take): waveform, trim (silencedetect
 * and the AC-5 rules into `cuts.reanalyse`), the transcript (spec 0012: inside the run, bounded
 * by the 120 s edit deadline, never fatal), the background, then the render unless there is
 * nothing to render (AC-7). The separate transcribe job starts after Ready only when the in run
 * transcript step failed.
 */
export async function fullRun(ctx: RunContext): Promise<RunResult> {
  const { client, job, take: t, signal, source, facts } = ctx;

  // Waveform (spec 0011, AC-11). Best effort, never fails the job.
  if (facts.hasAudio) {
    await storeWaveform(client, {
      jobId: job.id,
      takeId: t.id,
      source,
      durationMs: facts.durationMs,
      signal,
    });
  }

  // Trim. A take with no sound has nothing to trim: with no background it ends here (the
  // original is the video); with one it still renders, below.
  await setStep(ctx, "trim", "running", 0);
  if (!facts.hasAudio) {
    await setStep(ctx, "trim", "skipped", 0);
    // Nothing to transcribe: skipped `no_speech` here, before anything else (spec 0012).
    await transcriptStep(ctx, signal);
    await setStep(ctx, "ai_edit", "skipped", 0, "no_speech");
    if (!job.targetBackgroundId) {
      return finishWithoutRender(ctx, "no_audio", { withTranscript: false });
    }
  }
  let hasCuts = false;
  let candidates: ReturnType<typeof cutsFromSilences> = [];
  // Attempt 2 of a job whose AI edit is already stored: the trim must not write the rules cuts
  // over the AI cuts (spec 0012, Pipeline step 2).
  const aiStored = facts.hasAudio && (await aiEditAlreadyFinal(ctx));
  if (facts.hasAudio) {
    const trimProgress = throttledProgress((p) => setStep(ctx, "trim", "running", p));
    const stderr = await runFfmpeg(
      [...ORIGINAL_INPUT, "-i", source, "-vn", "-af", silencedetectFilter(), "-f", "null", "-"],
      {
        timeoutMs: 15 * 60_000,
        signal,
        onOutTimeMs: (ms) => void trimProgress.report((ms / facts.durationMs) * 100),
      },
    );
    candidates = cutsFromSilences(parseSilences(stderr, facts.durationMs), facts.durationMs);
    signal.throwIfAborted();
    if (aiStored) {
      hasCuts = await storedHasCuts(ctx);
    } else {
      const analysed = await whileJobActive(
        client,
        job.id,
        (tx) => reanalyse(tx, { takeId: t.id, proposed: candidates }),
        signal,
      );
      if (!analysed.ok) throw new Error(`reanalyse failed: ${analysed.error}`);
      hasCuts = analysed.data.cuts.some((c) => c.applied);
    }
    await trimProgress.flush();
    await setStep(ctx, "trim", "succeeded", 100);
  }

  // Transcript, inside the run. One edit deadline starts here and will also cover the AI edit
  // step (part 2); its signal bounds ffmpeg and Deepgram only, writes use the run signal.
  let withTranscript = false;
  if (facts.hasAudio) {
    const editSignal = AbortSignal.any([signal, AbortSignal.timeout(EDIT_DEADLINE_MS)]);
    const transcript = await transcriptStep(ctx, editSignal);
    withTranscript = transcript === "failed";
    // AI edit: one Claude call inside the same deadline. It never fails the run; on any problem
    // the rules cuts stored by the trim stay. `hasCuts` is taken again from what it wrote.
    const ai = await aiEditStep(ctx, editSignal, { transcript, candidates });
    if (ai.hasCuts !== null) hasCuts = ai.hasCuts;
    else if (aiStored) hasCuts = await storedHasCuts(ctx);
  }

  const backgroundFacts = await prepareBackground(ctx);

  // Spec 0008 AC-2: a take with a chosen background is always rendered (the whole take when
  // there are no cuts), keyed or not, so the render records which background it was for.
  if (!hasCuts && !backgroundFacts) {
    return finishWithoutRender(ctx, "no_cuts", { withTranscript });
  }

  return ship(ctx, await encode(ctx, backgroundFacts), { withTranscript });
}
