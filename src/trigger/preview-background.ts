import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger, task } from "@trigger.dev/sdk";
import { withJobDb } from "@/db/client/job";
import { queueDeletions } from "@/db/data/jobs";
import { completePreview, failPreview, loadPreviewWork } from "@/db/data/previews";
import type { Executor } from "@/db/types";
import {
  PREVIEW_LIMITS,
  PREVIEW_WIDTH,
  centreDifferenceShare,
  gateReadArgs,
  gateSize,
  isOnlyBackground,
  keyedPreviewGraph,
  plainPreviewFilter,
  previewHeight,
  previewKey,
} from "@/lib/background-preview";
import { ORIGINAL_INPUT, STORED_IMAGE_INPUT, STORED_IMAGE_URL_INPUT } from "@/lib/ffmpeg-input";
import { deadlineMs, runWithDeadline } from "@/lib/deadline";
import { parseJobEnv } from "@/lib/env";
import {
  type RawFrame,
  detectInFrame,
  erasesSubject,
  frameAlphaArgs,
  frameSampleArgs,
  fromHex,
  isKeyable,
  sampleFrameSize,
  toHex,
  transparentShare,
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

// Limits (2 attempts of 3 minutes, so the shared 90 s deadline margin still leaves 90 s of work)
// live in `PREVIEW_LIMITS` (src/lib/background-preview.ts): the web app's stale rule is derived from them.

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

  // The key colour: the latest render's when it was keyed (and still usable), else detected on
  // this frame. Either way it is tried on the frame first (S3S-T10): a key that would make more
  // than 85 % of it transparent would erase the person, so the preview shows the plain frame.
  const size = sampleFrameSize(facts.width, facts.height);
  let keyColor: string | null = null;
  const renderKey = work.latestRender?.keyed ? fromHex(work.latestRender.keyColor ?? "") : null;
  if (renderKey && isKeyable(renderKey)) {
    keyColor = toHex(renderKey);
  } else {
    const frame = await io.sampleFrame(originalUrl, timeMs, size, toneMap, signal);
    const found = detectInFrame(frame);
    keyColor = found.usable ? toHex(found.keyColor) : null;
  }
  if (keyColor) {
    const share = await io.sampleKeyedShare(originalUrl, timeMs, size, toneMap, keyColor, signal);
    if (erasesSubject(share)) keyColor = null;
  }

  const work_dir = await mkdtemp(join(tmpdir(), `preview-${previewId}-`));
  try {
    const out = join(work_dir, "preview.jpg");
    const seek = ["-ss", (timeMs / 1000).toFixed(3)];
    const plain = async () =>
      io.encode(
        [
          "-y",
          ...HTTP_INPUT,
          ...seek,
          ...ORIGINAL_INPUT,
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
    if (keyColor && bg.imageKey) {
      const imageUrl = await io.r2.presignGet(bg.imageKey, { expiresSeconds: 60 * 60 });
      await io.encode(
        [
          "-y",
          ...HTTP_INPUT,
          ...seek,
          ...ORIGINAL_INPUT,
          "-i",
          originalUrl,
          ...HTTP_INPUT,
          ...STORED_IMAGE_URL_INPUT,
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
      // Final gate (S3S-T12): a keyed still that is only the background has no person in it,
      // whatever the cause. Never record that as Ready: show the plain frame, no green screen.
      const gate = gateSize(facts.width, facts.height);
      const [still, backdrop] = await Promise.all([
        io.readImage(gateReadArgs(out, gate, null, STORED_IMAGE_INPUT), gate, signal),
        io.readImage(
          gateReadArgs(
            imageUrl,
            gate,
            { width: PREVIEW_WIDTH, height: previewHeight(facts.width, facts.height) },
            [...HTTP_INPUT, ...STORED_IMAGE_URL_INPUT],
          ),
          gate,
          signal,
        ),
      ]);
      if (isOnlyBackground(centreDifferenceShare(still, backdrop))) {
        logger.warn(
          "preview-background: keyed still is only the background, using the plain frame",
          {
            previewId,
            takeId: t.id,
            backgroundId: bg.id,
          },
        );
        keyColor = null;
        await plain();
      }
    } else {
      await plain();
    }
    signal?.throwIfAborted();

    // Read again before writing: the take, the background or the preview may be gone.
    if (!(await loadPreviewWork(db, previewId))) {
      logger.info("preview-background: gone before writing, nothing written", { previewId });
      return { outcome: "gone" };
    }
    const key = previewKey(t.id, previewId);
    await io.r2.putObject(key, new Uint8Array(await readFile(out)), "image/jpeg", { signal });
    // A timed out attempt must not record or clean up: the key is derived from the preview, so
    // a retry that already finished owns the same file and the row that points to it.
    signal?.throwIfAborted();
    const done = await completePreview(db, { previewId, noGreenScreen: keyColor === null });
    if (!done.ok) {
      // Another run finished the row: its file is at this key, leave it. Otherwise the row or
      // the take is gone (or expired) and nothing points at the file we wrote: remove it.
      if (done.error === "gone") {
        try {
          await io.r2.deleteObject(key);
        } catch {
          await queueDeletions(db, [key]);
        }
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
