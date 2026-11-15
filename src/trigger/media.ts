import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { originalInput } from "@/lib/ffmpeg-input";
import {
  type ProbeFacts,
  needsPacketEnd,
  parseFfprobe,
  parsePacketEnd,
  thumbnailSeconds,
} from "@/lib/probe";
import { toneMapFilter } from "@/lib/trim";
import { runTool } from "./media-tools";

export { toneMapFilter };
export { MediaToolError, runFfmpeg, runFfmpegBytes } from "./media-tools";
export { imageInputOfFile, probeImageFile } from "./media-image";

/**
 * ffprobe and ffmpeg runners for media read over a presigned URL (spec 0004, Flow step 4).
 * The tools themselves are in `media-tools.ts` and the image probe in `media-image.ts`; this
 * file keeps the video probe and the thumbnail and re-exports the rest, so imports stay
 * `./media`. The URL is a secret: it is never logged.
 */

/** ffprobe options for reading over HTTP with range requests (moov at the end works). */
const HTTP_INPUT = ["-rw_timeout", "30000000", "-reconnect", "1", "-reconnect_streamed", "1"];

/**
 * Probes media at `url` (60 s limit). Returns the facts, or null when ffprobe ran but found no
 * usable video (the take then fails as corrupt). Throws MediaToolError when ffprobe itself
 * failed, so the caller can tell a bad file from a flaky read.
 */
export async function probeUrl(url: string, signal?: AbortSignal): Promise<ProbeFacts | null> {
  return probeInput(url, HTTP_INPUT, signal);
}

/**
 * ffprobe of one stored original (MP4, MOV or WebM). A WebM from a browser has no duration
 * header, so for it a second pass reads the packet times and the last one gives the length.
 */
async function probeInput(
  input: string,
  network: readonly string[],
  signal?: AbortSignal,
): Promise<ProbeFacts | null> {
  const stdout = await runTool(
    "ffprobe",
    [
      "-v",
      "error",
      ...network,
      ...originalInput(input),
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      input,
    ],
    60_000,
    signal,
  );
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!needsPacketEnd(json)) return parseFfprobe(json);
  const packets = await runTool(
    "ffprobe",
    [
      "-v",
      "error",
      ...network,
      ...originalInput(input),
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      input,
    ],
    60_000,
    signal,
  );
  return parseFfprobe(json, { packetEndSeconds: parsePacketEnd(packets) });
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
        ...originalInput(url),
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

/** Probes a local file (no network options). */
export async function probeFile(path: string, signal?: AbortSignal): Promise<ProbeFacts | null> {
  return probeInput(path, [], signal);
}
