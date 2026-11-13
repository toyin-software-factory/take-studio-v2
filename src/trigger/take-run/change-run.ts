import { storeWaveform } from "../waveform";
import { prepareBackground } from "./background";
import type { RunContext, RunResult } from "./context";
import { encode } from "./render";
import { ship } from "./ship";

/**
 * A background change (spec 0008) or cut change (spec 0011): a job of kind `background`, on a
 * take that is already Ready. It reuses the take's applied cuts (the render snapshot reads
 * them), so it neither trims nor re analyses, always renders, and starts no transcript.
 */
export async function changeRun(ctx: RunContext): Promise<RunResult> {
  const { client, job, take: t, signal, source, facts } = ctx;

  // Waveform (spec 0011, AC-11): only while the take has none yet (a take processed before this
  // shipped). Best effort, never fails the job.
  if (facts.hasAudio && t.waveform == null) {
    await storeWaveform(client, {
      jobId: job.id,
      takeId: t.id,
      source,
      durationMs: facts.durationMs,
      signal,
    });
  }

  const backgroundFacts = await prepareBackground(ctx);
  return ship(ctx, await encode(ctx, backgroundFacts), { withTranscript: false });
}
