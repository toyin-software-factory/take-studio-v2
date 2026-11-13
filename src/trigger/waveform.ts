import { ORIGINAL_INPUT } from "@/lib/ffmpeg-input";
import { logger } from "@trigger.dev/sdk";
import type { Executor } from "@/db/types";
import { whileJobActive } from "@/db/data/jobs";
import { saveWaveform } from "@/db/data/waveform";
import { WAVEFORM, alignSamples, samplesFromPcm16, waveformFromSamples } from "@/lib/waveform";
import { runFfmpegBytes } from "./media";

/** ffmpeg arguments for the waveform pass: mono 8 kHz signed 16 bit PCM on stdout. */
export const waveformArgs = (source: string): readonly string[] => [
  "-hide_banner",
  "-v",
  "error",
  ...ORIGINAL_INPUT,
  "-i",
  source,
  "-vn",
  "-ac",
  "1",
  "-ar",
  String(WAVEFORM.sampleRate),
  "-f",
  "s16le",
  "-",
];

/**
 * Computes and stores the take's waveform (spec 0011, AC-11) from the downloaded original.
 * Best effort: a failure logs the take and job IDs and leaves `take.waveform` as it was, and
 * never fails the job. Only the job's own deadline (`signal`) is rethrown. The values are the
 * shape of the creator's voice: never logged.
 */
export async function storeWaveform(
  client: Executor,
  input: {
    readonly jobId: string;
    readonly takeId: string;
    readonly source: string;
    readonly durationMs: number;
    readonly signal: AbortSignal;
  },
): Promise<void> {
  const { jobId, takeId, signal } = input;
  try {
    const pcm = await runFfmpegBytes(waveformArgs(input.source), { timeoutMs: 5 * 60_000, signal });
    const waveform = waveformFromSamples(
      alignSamples(samplesFromPcm16(pcm), input.durationMs),
      input.durationMs,
    );
    if (!waveform) return;
    const saved = await whileJobActive(
      client,
      jobId,
      (tx) => saveWaveform(tx, { takeId, waveform }),
      signal,
    );
    if (!saved.ok)
      logger.warn("process-take: waveform not saved", { takeId, jobId, reason: saved.error });
  } catch {
    signal.throwIfAborted();
    logger.warn("process-take: waveform failed", { takeId, jobId });
  }
}
