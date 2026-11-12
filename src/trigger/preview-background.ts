import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger, task } from "@trigger.dev/sdk";
import { withJobDb } from "@/db/client/job";
import { queueDeletions } from "@/db/data/jobs";
import { completePreview, failPreview, loadPreviewWork } from "@/db/data/previews";
import type { Executor } from "@/db/types";
import { keyedPreviewGraph, plainPreviewFilter, previewKey } from "@/lib/background-preview";
import { deadlineMs, runWithDeadline } from "@/lib/deadline";
import { parseJobEnv } from "@/lib/env";
import {
  type RawFrame,
  detectInFrame,
  frameSampleArgs,
  sampleFrameSize,
  toHex,
} from "@/lib/keying";
import { thumbnailSeconds } from "@/lib/probe";
import { type R2, createR2 } from "@/lib/r2";
import { toneMapFilter } from "@/lib/trim";
import { MediaToolError, probeUrl, runFfmpeg, runFfmpegBytes } from "./media";

/**
 * `preview-background` (spec 0008, Pipeline 4; AC-4): one still of a take on a background, so a
 * creator sees the result before waiting for a re render. Payload `{ previewId }` only. ffmpeg
 * seeks to the thumbnail's time through the presigned original (HTTP range, no full download),
 * tone maps it, reuses the latest render's key colour when that render was keyed (else detects
 * on the frame), keys onto the background and writes a 1280 wide JPEG. One at a time per take:
 * triggered with the concurrency key `preview-{takeId}` on a queue of limit 1. Never logs a
 * frame, a key or a link.
 */

/** Limits: 2 attempts; 3 minutes, so the shared 90 s deadline margin still leaves 90 s of work. */
export const PREVIEW_LIMITS = { maxDurationSeconds: 180, maxAttempts: 2 } as const;

/** Input options for reading a presigned URL with range requests and reconnects. */
const HTTP_INPUT = ["-rw_timeout", "30000000", "-reconnect", "1", "-reconnect_streamed", "1"];

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
  /** Runs ffmpeg with `args` (the job adds nothing); the result is the JPEG at `outPath`. */
  readonly encode: (args: readonly string[], signal?: AbortSignal) => Promise<void>;
};

export type PreviewOutcome =
  | { readonly outcome: "skipped" }
  | { readonly outcome: "gone" }
  | { readonly outcome: "ready"; readonly noGreenScreen: boolean };

/**
 * Makes one preview. Re reads the rows before it writes: a take, background or preview that
 * went away (or a row that was reset or finished) means nothing is written, and a file already
 * uploaded when the row vanishes is removed again.
 */
export async function makePreview(
  db: Executor,
  previewId: string,
  io: PreviewIo,
  signal?: AbortSignal,
): Promise<PreviewOutcome> {
  const work = await loadPreviewWork(db, previewId);
  if (!work) {
    logger.info("preview-background: nothing to do", { previewId });
    return { outcome: "skipped" };
  }
  const { take: t, background: bg } = work;
  const originalUrl = await io.r2.presignGet(t.originalKey, { expiresSeconds: 60 * 60 });
  const facts = await io.probe(originalUrl, signal);
  if (!facts) throw new MediaToolError("ffprobe", null, false);
  const timeMs = thumbnailSeconds(facts.durationMs) * 1000;
  const toneMap = facts.hdrTransfer ? toneMapFilter(facts.hdrTransfer) : null;

  // The key colour: the latest render's when it was keyed, else detected on this frame.
  let keyColor: string | null = null;
  if (work.latestRender?.keyed && work.latestRender.keyColor) {
    keyColor = work.latestRender.keyColor;
  } else {
    const size = sampleFrameSize(facts.width, facts.height);
    const frame = await io.sampleFrame(originalUrl, timeMs, size, toneMap, signal);
    const found = detectInFrame(frame);
    keyColor = found.usable ? toHex(found.keyColor) : null;
  }

  const work_dir = await mkdtemp(join(tmpdir(), `preview-${previewId}-`));
  try {
    const out = join(work_dir, "preview.jpg");
    const seek = ["-ss", (timeMs / 1000).toFixed(3)];
    if (keyColor && bg.imageKey) {
      const imageUrl = await io.r2.presignGet(bg.imageKey, { expiresSeconds: 60 * 60 });
      await io.encode(
        [
          "-y",
          ...HTTP_INPUT,
          ...seek,
          "-i",
          originalUrl,
          ...HTTP_INPUT,
          "-i",
          imageUrl,
          "-filter_complex",
          keyedPreviewGraph({
            keyColor,
            takeWidth: facts.width,
            takeHeight: facts.height,
            toneMap,
          }),
          "-map",
          "[vout]",
          "-frames:v",
          "1",
          "-q:v",
          "3",
          out,
        ],
        signal,
      );
    } else {
      await io.encode(
        [
          "-y",
          ...HTTP_INPUT,
          ...seek,
          "-i",
          originalUrl,
          "-vf",
          plainPreviewFilter({ takeWidth: facts.width, takeHeight: facts.height, toneMap }),
          "-frames:v",
          "1",
          "-q:v",
          "3",
          out,
        ],
        signal,
      );
    }
    signal?.throwIfAborted();

    // Read again before writing: the take, the background or the preview may be gone.
    if (!(await loadPreviewWork(db, previewId))) {
      logger.info("preview-background: gone before writing, nothing written", { previewId });
      return { outcome: "gone" };
    }
    const key = previewKey(t.id, previewId);
    await io.r2.putObject(key, new Uint8Array(await readFile(out)), "image/jpeg");
    const done = await completePreview(db, { previewId, noGreenScreen: keyColor === null });
    if (!done.ok) {
      // The row vanished while we uploaded: do not leave the file behind.
      try {
        await io.r2.deleteObject(key);
      } catch {
        await queueDeletions(db, [key]);
      }
      return { outcome: "gone" };
    }
    logger.info("preview-background: ready", { previewId, noGreenScreen: keyColor === null });
    return { outcome: "ready", noGreenScreen: keyColor === null };
  } finally {
    await rm(work_dir, { recursive: true, force: true });
  }
}

export const previewBackgroundTask = task({
  id: "preview-background",
  machine: "small-2x",
  maxDuration: PREVIEW_LIMITS.maxDurationSeconds,
  retry: { maxAttempts: PREVIEW_LIMITS.maxAttempts },
  // One at a time per take: the web app triggers with the concurrency key `preview-{takeId}`.
  queue: { concurrencyLimit: 1 },
  run: async (payload: { readonly previewId: string }) => {
    const env = parseJobEnv();
    const r2 = createR2(env);
    return runWithDeadline(deadlineMs(PREVIEW_LIMITS.maxDurationSeconds), (signal) =>
      withJobDb(env.DATABASE_URL, (db) =>
        makePreview(
          db,
          payload.previewId,
          {
            r2,
            probe: probeUrl,
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
            encode: async (args, stop) => {
              await runFfmpeg(args, { timeoutMs: 90_000, signal: stop });
            },
          },
          signal,
        ),
      ),
    );
  },
  onFailure: async ({ payload }) => {
    const env = parseJobEnv();
    await withJobDb(env.DATABASE_URL, (db) => failPreview(db, payload.previewId));
  },
});
