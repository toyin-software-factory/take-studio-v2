import { execFile, spawn } from "node:child_process";
import { JOB_ERROR_NAMES } from "@/lib/job-errors";
import { progressOutTimeMs } from "@/lib/trim";

/**
 * The ffprobe and ffmpeg runners behind `media.ts`. The URL a tool reads is a secret: it is
 * never logged, and errors are rebuilt from the exit code and a short reason only (Node's own
 * error text would include the command line, URL and all).
 */

const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

/** A media tool failure that carries no URL or file content. */
export class MediaToolError extends Error {
  override name = JOB_ERROR_NAMES.mediaTool;
  constructor(
    readonly tool: "ffprobe" | "ffmpeg",
    readonly exitCode: number | null,
    readonly timedOut: boolean,
  ) {
    super(`${tool} failed (${timedOut ? "timed out" : `exit ${exitCode ?? "?"}`})`);
  }
}

/** Runs a tool and returns stdout; any failure becomes a MediaToolError without the arguments. */
export function runTool(
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
