import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HdrTransfer, type ProbeFacts, parseFfprobe, thumbnailSeconds } from "@/lib/probe";

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
): Promise<string> {
  const bin = tool === "ffprobe" ? FFPROBE : FFMPEG;
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" },
      (error, stdout) => {
        if (!error) return resolve(stdout);
        const code = typeof error.code === "number" ? error.code : null;
        reject(new MediaToolError(tool, code, error.killed === true));
      },
    );
  });
}

/** ffprobe options for reading over HTTP with range requests (moov at the end works). */
const HTTP_INPUT = ["-rw_timeout", "30000000", "-reconnect", "1", "-reconnect_streamed", "1"];

/**
 * Probes media at `url` (60 s limit). Returns the facts, or null when ffprobe ran but found no
 * usable video (the take then fails as corrupt). Throws MediaToolError when ffprobe itself
 * failed, so the caller can tell a bad file from a flaky read.
 */
export async function probeUrl(url: string): Promise<ProbeFacts | null> {
  const stdout = await runTool(
    "ffprobe",
    ["-v", "error", ...HTTP_INPUT, "-print_format", "json", "-show_format", "-show_streams", url],
    60_000,
  );
  try {
    return parseFfprobe(JSON.parse(stdout));
  } catch {
    return null;
  }
}

/** zscale tone map from an HDR transfer to BT.709 (zscale needs the input transfer spelled out). */
export function toneMapFilter(transfer: HdrTransfer): string {
  return [
    `zscale=tin=${transfer}:min=bt2020nc:pin=bt2020:t=linear:npl=100`,
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
  ].join(",");
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
