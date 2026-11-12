import type { HdrTransfer } from "@/lib/probe";
import {
  type Detection,
  type RawFrame,
  detectGreenScreen,
  erasesSubject,
  frameAlphaArgs,
  frameSampleArgs,
  sampleFrameSize,
  sampleTimesMs,
  toHex,
  transparentShare,
} from "@/lib/keying";
import { toneMapFilter } from "@/lib/trim";
import { MediaToolError, runFfmpegBytes } from "./media";

/**
 * The ffmpeg side of green screen detection (spec 0008, Rationale): decodes the five sample
 * frames of a local file, tone mapped like the render, and hands them to `detectGreenScreen`
 * in `src/lib/keying.ts`, which decides. Never logs a frame or a path.
 */

/** The background the job should render onto is gone or not ready (refundable, spec 0008). */
export class BackgroundMissingError extends Error {
  override name = "BackgroundMissingError";
  constructor() {
    super("The background for this job is missing or not ready");
  }
}

type SourceFacts = {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly hdrTransfer: HdrTransfer | null;
};

/** Decodes one frame as raw RGB at the sample size; refuses a short read. */
async function sampleFrame(
  source: string,
  timeMs: number,
  size: { readonly width: number; readonly height: number },
  toneMap: string | null,
  signal?: AbortSignal,
): Promise<RawFrame> {
  const bytes = await runFfmpegBytes(frameSampleArgs(source, timeMs, size, toneMap), {
    timeoutMs: 60_000,
    signal,
  });
  if (bytes.length !== size.width * size.height * 3)
    throw new MediaToolError("ffmpeg", null, false);
  return { width: size.width, height: size.height, data: new Uint8Array(bytes) };
}

/**
 * The share of one frame that keying with `keyColor` makes transparent, measured by ffmpeg itself
 * on the same decode and tone map the render uses (S3S-T10). Refuses a short read.
 */
export async function sampleKeyedShare(
  source: string,
  timeMs: number,
  size: { readonly width: number; readonly height: number },
  toneMap: string | null,
  keyColor: string,
  signal?: AbortSignal,
): Promise<number> {
  const bytes = await runFfmpegBytes(frameAlphaArgs(source, timeMs, size, toneMap, keyColor), {
    timeoutMs: 60_000,
    signal,
  });
  if (bytes.length !== size.width * size.height) throw new MediaToolError("ffmpeg", null, false);
  return transparentShare(new Uint8Array(bytes));
}

/**
 * Samples the take at 10, 30, 50, 70 and 90 % and decides whether it has a usable green screen.
 * A key that the frames say is usable is then tried on them: when it would make more than 85 %
 * of a typical frame transparent it would erase the subject with the screen, so the take counts
 * as having no green screen (the original background is kept) instead.
 */
export async function detectInFile(
  source: string,
  facts: SourceFacts,
  signal?: AbortSignal,
): Promise<Detection> {
  const size = sampleFrameSize(facts.width, facts.height);
  const toneMap = facts.hdrTransfer ? toneMapFilter(facts.hdrTransfer) : null;
  const frames: RawFrame[] = [];
  for (const timeMs of sampleTimesMs(facts.durationMs)) {
    frames.push(await sampleFrame(source, timeMs, size, toneMap, signal));
  }
  const detection = detectGreenScreen(frames);
  if (!detection.usable) return detection;
  const keyColor = toHex(detection.keyColor);
  const shares: number[] = [];
  for (const timeMs of sampleTimesMs(facts.durationMs)) {
    shares.push(await sampleKeyedShare(source, timeMs, size, toneMap, keyColor, signal));
  }
  shares.sort((a, b) => a - b);
  // The median frame decides, so one odd frame (a cut, a flash) does not.
  if (erasesSubject(shares[shares.length >> 1]!)) {
    return { usable: false, greenFrames: detection.greenFrames, reason: "erases_subject" };
  }
  return detection;
}
