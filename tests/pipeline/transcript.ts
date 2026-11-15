/**
 * Transcript checks for the pipeline run (spec 0007 build plan step 6): tiny synthetic speech
 * fixtures against real Deepgram. AC-1 (Ready first, then the transcript, 0 charged, take
 * untouched), AC-6 (not English), AC-7 (no speech, no audio stream), AC-2 and AC-4 (the SRT lands
 * on the trimmed video within one frame), AC-9 (refusals), AC-10 (expired and deleted takes).
 * Called from run.ts with its helpers, so the services and the creators are shared.
 * The sections live in transcript-english.ts, transcript-speech.ts and transcript-expiry.ts;
 * transcript-env.ts holds what they share.
 */
import { englishScenarios } from "./transcript-english";
import { expiryScenarios } from "./transcript-expiry";
import { type Ctx } from "./transcript-env";
import { speechScenarios } from "./transcript-speech";

export type { Ctx };

export async function transcriptScenarios(ctx: Ctx): Promise<void> {
  const english = await englishScenarios(ctx);
  const quiet = await speechScenarios(ctx);
  await expiryScenarios(ctx, english, quiet);
}
