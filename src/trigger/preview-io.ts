import { frameAlphaArgs, frameSampleArgs, transparentShare, type RawFrame } from "@/lib/keying";
import type { R2 } from "@/lib/r2";
import { MediaToolError, type probeUrl, runFfmpeg, runFfmpegBytes } from "./media";

/** Input options for reading a presigned URL with range requests and reconnects. */
export const HTTP_INPUT = [
  "-rw_timeout",
  "30000000",
  "-reconnect",
  "1",
  "-reconnect_streamed",
  "1",
];

/** The outside world of one attempt, so tests can fake R2 and ffmpeg. */
export type PreviewIo = {
  readonly r2: Pick<R2, "presignGet" | "putObject" | "deleteObject">;
  readonly probe: typeof probeUrl;
  /** One RGB frame of `url` at `timeMs`, tone mapped, at `size` (for detection). */
  readonly sampleFrame: (
    url: string,
    timeMs: number,
    size: { readonly width: number; readonly height: number },
    toneMap: string | null,
    signal?: AbortSignal,
  ) => Promise<RawFrame>;
  /** The share of that frame keying with `keyColor` would make transparent (S3S-T10 guard). */
  readonly sampleKeyedShare: (
    url: string,
    timeMs: number,
    size: { readonly width: number; readonly height: number },
    toneMap: string | null,
    keyColor: string,
    signal?: AbortSignal,
  ) => Promise<number>;
  /** Reads one image through ffmpeg `args` as raw `rgb24` of the given size (the final gate). */
  readonly readImage: (
    args: readonly string[],
    size: { readonly width: number; readonly height: number },
    signal?: AbortSignal,
  ) => Promise<RawFrame>;
  /** Runs ffmpeg with `args` (the job adds nothing); the result is the JPEG at `outPath`. */
  readonly encode: (args: readonly string[], signal?: AbortSignal) => Promise<void>;
};

/** The real `PreviewIo`: R2, ffprobe and ffmpeg, each tool call with its own time limit. */
export function createPreviewIo(r2: PreviewIo["r2"], probe: PreviewIo["probe"]): PreviewIo {
  return {
    r2,
    probe,
    sampleFrame: async (url, timeMs, size, toneMap, stop) => {
      const bytes = await runFfmpegBytes(
        [...HTTP_INPUT, ...frameSampleArgs(url, timeMs, size, toneMap)],
        { timeoutMs: 60_000, signal: stop },
      );
      if (bytes.length !== size.width * size.height * 3) {
        throw new MediaToolError("ffmpeg", null, false);
      }
      return { width: size.width, height: size.height, data: new Uint8Array(bytes) };
    },
    sampleKeyedShare: async (url, timeMs, size, toneMap, keyColor, stop) => {
      const bytes = await runFfmpegBytes(
        [...HTTP_INPUT, ...frameAlphaArgs(url, timeMs, size, toneMap, keyColor)],
        { timeoutMs: 60_000, signal: stop },
      );
      if (bytes.length !== size.width * size.height) {
        throw new MediaToolError("ffmpeg", null, false);
      }
      return transparentShare(new Uint8Array(bytes));
    },
    readImage: async (args, size, stop) => {
      const bytes = await runFfmpegBytes([...args], { timeoutMs: 60_000, signal: stop });
      if (bytes.length !== size.width * size.height * 3) {
        throw new MediaToolError("ffmpeg", null, false);
      }
      return { width: size.width, height: size.height, data: new Uint8Array(bytes) };
    },
    encode: async (args, stop) => {
      await runFfmpeg(args, { timeoutMs: 90_000, signal: stop });
    },
  };
}
