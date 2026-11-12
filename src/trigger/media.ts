import { execFile, spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ImageFacts } from "@/lib/background-rules";
import { type ProbeFacts, parseFfprobe, thumbnailSeconds } from "@/lib/probe";
import { progressOutTimeMs, toneMapFilter } from "@/lib/trim";

export { toneMapFilter };

/**
 * ffprobe and ffmpeg runners for media read over a presigned URL (spec 0004, Flow step 4).
 * The URL is a secret: it is never logged, and errors are rebuilt from the exit code and a
 * short reason only (Node's own error text would include the command line, URL and all).
 */

const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

/** A media tool failure that carries no URL or file content. */
export class MediaToolError extends Error {
  override name = "MediaToolError";
  constructor(
    readonly tool: "ffprobe" | "ffmpeg",
    readonly exitCode: number | null,
    readonly timedOut: boolean,
  ) {
    super(`${tool} failed (${timedOut ? "timed out" : `exit ${exitCode ?? "?"}`})`);
  }
}

/** Runs a tool and returns stdout; any failure becomes a MediaToolError without the arguments. */
function runTool(
  tool: "ffprobe" | "ffmpeg",
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const bin = tool === "ffprobe" ? FFPROBE : FFMPEG;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    // Not the `signal` option of execFile: that rejects at once, before the process is gone.
    // The child is killed here and the callback (which waits for the exit) settles the promise.
    const child = execFile(
      bin,
      [...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" },
      (error, stdout) => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) return reject(signal.reason);
        if (!error) return resolve(stdout);
        const code = typeof error.code === "number" ? error.code : null;
        reject(new MediaToolError(tool, code, error.killed === true));
      },
    );
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** ffprobe options for reading over HTTP with range requests (moov at the end works). */
const HTTP_INPUT = ["-rw_timeout", "30000000", "-reconnect", "1", "-reconnect_streamed", "1"];

/**
 * Probes media at `url` (60 s limit). Returns the facts, or null when ffprobe ran but found no
 * usable video (the take then fails as corrupt). Throws MediaToolError when ffprobe itself
 * failed, so the caller can tell a bad file from a flaky read.
 */
export async function probeUrl(url: string, signal?: AbortSignal): Promise<ProbeFacts | null> {
  const stdout = await runTool(
    "ffprobe",
    ["-v", "error", ...HTTP_INPUT, "-print_format", "json", "-show_format", "-show_streams", url],
    60_000,
    signal,
  );
  try {
    return parseFfprobe(JSON.parse(stdout));
  } catch {
    return null;
  }
}

/**
 * A 640 px wide JPEG of the frame at 1 s (0 for short clips), tone mapped when HDR, rotated as
 * displayed. Returns the image bytes.
 */
export async function thumbnailFromUrl(
  url: string,
  facts: Pick<ProbeFacts, "durationMs" | "hdrTransfer">,
  name: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = join(tmpdir(), `${name}-thumb.jpg`);
  const filters = [facts.hdrTransfer ? toneMapFilter(facts.hdrTransfer) : null, "scale=640:-2"]
    .filter(Boolean)
    .join(",");
  try {
    await runTool(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...HTTP_INPUT,
        "-ss",
        String(thumbnailSeconds(facts.durationMs)),
        "-i",
        url,
        "-frames:v",
        "1",
        "-vf",
        filters,
        "-q:v",
        "4",
        out,
      ],
      60_000,
    );
    const bytes = await readFile(out);
    return new Uint8Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  } finally {
    await rm(out, { force: true });
  }
}

/**
 * Runs ffmpeg, streaming `-progress pipe:1` to `onOutTimeMs` (output time so far, ms), and
 * returns stderr (where `silencedetect` reports). Errors carry the exit code only.
 */
export function runFfmpeg(
  args: readonly string[],
  options: {
    readonly timeoutMs: number;
    readonly onOutTimeMs?: (ms: number) => void;
    /** The job deadline: ffmpeg is killed and the promise rejects with the signal's reason. */
    readonly signal?: AbortSignal;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    if (signal?.aborted) return reject(signal.reason);
    const child = spawn(FFMPEG, ["-hide_banner", "-nostats", "-progress", "pipe:1", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const ms = progressOutTimeMs(chunk);
      if (ms !== null) options.onOutTimeMs?.(ms);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Keep the tail only; silencedetect lines are short and frequent.
      stderr = (stderr + chunk).slice(-4 * 1024 * 1024);
    });
    child.on("error", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.aborted ? signal.reason : new MediaToolError("ffmpeg", null, false));
    });
    // Settles only once the process has exited, so nothing is left running after an abort.
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(signal.reason);
      if (code === 0 && !timedOut) resolve(stderr);
      else reject(new MediaToolError("ffmpeg", code, timedOut));
    });
  });
}

/** Probes a local file (no network options). */
export async function probeFile(path: string, signal?: AbortSignal): Promise<ProbeFacts | null> {
  const stdout = await runTool(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
    60_000,
    signal,
  );
  try {
    return parseFfprobe(JSON.parse(stdout));
  } catch {
    return null;
  }
}

/**
 * Runs ffmpeg and returns what it wrote to stdout (raw frame bytes), killing it when `signal`
 * aborts and settling only after it exited, like `runTool`. Errors carry the exit code only.
 */
export function runFfmpegBytes(
  args: readonly string[],
  options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<Buffer> {
  const { signal } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const child = execFile(
      FFMPEG,
      [...args],
      {
        timeout: options.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        killSignal: "SIGKILL",
        encoding: "buffer",
      },
      (error, stdout) => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) return reject(signal.reason);
        if (!error) return resolve(stdout);
        const code = typeof error.code === "number" ? error.code : null;
        reject(new MediaToolError("ffmpeg", code, error.killed === true));
      },
    );
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const imageStreams = z.object({
  streams: z
    .array(
      z.object({
        codec_name: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        nb_read_packets: z.string().optional(),
      }),
    )
    .default([]),
});
const imageFrames = z.object({
  frames: z
    .array(
      z.object({
        side_data_list: z.array(z.object({ rotation: z.number().optional() }).loose()).optional(),
      }),
    )
    .default([]),
});

/**
 * Facts about a local image (spec 0008, Pipeline step 5): codec, size, packet count (more than
 * one means animated) and the rotation of the first frame (EXIF orientation as a display
 * matrix). The frame is decoded only when the pixel count is within `maxPixels`, so a
 * decompression bomb is never decoded here. Null when ffprobe finds no video stream.
 */
export async function probeImageFile(
  path: string,
  maxPixels: number,
  signal?: AbortSignal,
): Promise<ImageFacts | null> {
  const streams = imageStreams.safeParse(
    JSON.parse(
      await runTool(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-count_packets",
          "-show_entries",
          "stream=codec_name,width,height,nb_read_packets",
          "-of",
          "json",
          path,
        ],
        60_000,
        signal,
      ),
    ),
  );
  const stream = streams.success ? streams.data.streams[0] : undefined;
  if (!stream?.codec_name) return null;
  const width = stream.width ?? 0;
  const height = stream.height ?? 0;
  const base = {
    codec: stream.codec_name,
    width,
    height,
    frames: Number(stream.nb_read_packets ?? "1") || 1,
    rotation: 0,
  };
  if (width * height > maxPixels || width <= 0 || height <= 0) return base;
  const frames = imageFrames.safeParse(
    JSON.parse(
      await runTool(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-read_intervals",
          "%+#1",
          "-show_frames",
          "-of",
          "json",
          path,
        ],
        60_000,
        signal,
      ),
    ),
  );
  const rotation = frames.success
    ? (frames.data.frames[0]?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0)
    : 0;
  return { ...base, rotation };
}
