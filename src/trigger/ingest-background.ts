import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger, task } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { withJobDb } from "@/db/client/job";
import { failIngest, saveIngest } from "@/db/data/backgrounds";
import { queueDeletions } from "@/db/data/jobs";
import { background } from "@/db/schema";
import type { Executor } from "@/db/types";
import {
  BACKGROUND_IMAGE,
  BACKGROUND_UPLOAD,
  type BackgroundFailureCode,
  type ImageFacts,
  backgroundKeys,
  checkImageFacts,
  displaySize,
  isAnimatedWebp,
  rotationFilter,
} from "@/lib/background-rules";
import { INGEST_BACKGROUND_LIMITS } from "@/lib/cleanup-rules";
import { deadlineMs, runWithDeadline } from "@/lib/deadline";
import { parseJobEnv } from "@/lib/env";
import { type R2, createR2 } from "@/lib/r2";
import { downloadToFile } from "@/lib/r2-file-upload";
import { MediaToolError, probeImageFile, runFfmpeg } from "./media";

/**
 * `ingest-background` (spec 0008, Pipeline step 5; AC-8 to AC-10). Dispatched by `/complete`
 * with the background ID only, key `ingest-{id}`. HEAD the source (more bytes than declared, or
 * over 10 MiB: `image_too_large`) → download → refuse what is not a still JPEG, PNG or WebP
 * (`image_invalid`, `image_animated`), too small or over 40 megapixels (checked before anything
 * is decoded) → decode the first frame (EXIF rotation applied, transparency flattened on black,
 * 8 bit) → `image.jpg` within 3840 by 2160 and a 480 by 270 `thumb.webp` → `ready`. It re-reads
 * the row before writing: deleted meanwhile, it writes nothing and queues the files. IDs and
 * counts only; never the image, its keys or links.
 */

/** What the ingest needs from the outside, so tests can drive it without R2 or ffmpeg. */
export type IngestIo = {
  readonly head: (key: string) => Promise<{ readonly size: number } | null>;
  readonly presignGet: (key: string) => Promise<string>;
  readonly download: (url: string, path: string, signal: AbortSignal) => Promise<number>;
  /** The first bytes of the file, for the container checks ffprobe cannot make. */
  readonly readHead: (path: string) => Promise<Uint8Array>;
  readonly probe: (path: string, signal: AbortSignal) => Promise<ImageFacts | null>;
  /** Writes `image.jpg` and `thumb.webp` into `dir` from the decoded first frame. */
  readonly convert: (
    source: string,
    dir: string,
    facts: ImageFacts,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly put: (
    key: string,
    path: string,
    contentType: string,
    signal: AbortSignal,
  ) => Promise<void>;
};

export type IngestOutcome =
  | { readonly outcome: "ready" }
  | { readonly outcome: "refused"; readonly code: BackgroundFailureCode }
  | { readonly outcome: "skipped" }
  | { readonly outcome: "gone" };

/** The ffmpeg graph: first frame, transparency on black, fitted inside 3840x2160, plus the thumbnail. */
export function convertArgs(source: string, dir: string, facts: ImageFacts): string[] {
  const display = displaySize(facts);
  const { maxWidth, maxHeight, thumbWidth, thumbHeight } = BACKGROUND_IMAGE;
  const graph = [
    `[0:v]${rotationFilter(facts.rotation)}format=rgba[fg]`,
    `color=c=black:s=${display.width}x${display.height}[bg]`,
    `[bg][fg]overlay=format=auto:shortest=1,` +
      `scale=w='min(iw,${maxWidth})':h='min(ih,${maxHeight})':force_original_aspect_ratio=decrease:flags=lanczos,` +
      `format=yuvj420p,split[a][b]`,
    `[b]scale=${thumbWidth}:${thumbHeight}:force_original_aspect_ratio=increase:flags=lanczos,` +
      `crop=${thumbWidth}:${thumbHeight},format=yuv420p[t]`,
  ].join(";");
  return [
    "-y",
    "-noautorotate",
    "-i",
    source,
    "-filter_complex",
    graph,
    "-map",
    "[a]",
    "-frames:v",
    "1",
    "-q:v",
    "2",
    join(dir, "image.jpg"),
    "-map",
    "[t]",
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "85",
    join(dir, "thumb.webp"),
  ];
}

export async function ingestBackground(
  db: Executor,
  backgroundId: string,
  io: IngestIo,
  dir: string,
  signal: AbortSignal,
): Promise<IngestOutcome> {
  const [row] = await db.select().from(background).where(eq(background.id, backgroundId));
  // Deleted, or no longer processing (cleanup failed it, or a repeat run): nothing to do.
  if (!row || row.status !== "processing" || !row.creatorId) return { outcome: "skipped" };
  const keys = backgroundKeys(row.creatorId, row.id);
  const refuse = async (code: BackgroundFailureCode): Promise<IngestOutcome> => {
    await failIngest(db, backgroundId, code);
    return { outcome: "refused", code };
  };

  const stored = await io.head(keys.sourceKey);
  if (!stored) return refuse("upload_incomplete");
  const declared = row.bytes ?? BACKGROUND_UPLOAD.maxBytes;
  if (stored.size > declared || stored.size > BACKGROUND_UPLOAD.maxBytes) {
    return refuse("image_too_large");
  }

  const source = join(dir, "source");
  await io.download(await io.presignGet(keys.sourceKey), source, signal);
  if (isAnimatedWebp(await io.readHead(source))) return refuse("image_animated");
  const facts = await io.probe(source, signal);
  if (!facts) return refuse("image_invalid");
  const broken = checkImageFacts(facts);
  if (broken) return refuse(broken);

  await io.convert(source, dir, facts, signal);
  const size = await io.probe(join(dir, "image.jpg"), signal);
  if (!size) return refuse("ingest_error");
  try {
    await io.put(keys.imageKey, join(dir, "image.jpg"), "image/jpeg", signal);
    await io.put(keys.thumbKey, join(dir, "thumb.webp"), "image/webp", signal);
  } catch (error) {
    // A write that fails after the creator deleted the background (the delete may already have
    // drained its keys) would leave a file nobody owns. While the row exists a retry just
    // overwrites the files, so only a missing row is cleaned up here.
    const [still] = await db
      .select({ id: background.id })
      .from(background)
      .where(eq(background.id, backgroundId));
    if (!still) await queueDeletions(db, [keys.sourceKey, keys.imageKey, keys.thumbKey]);
    throw error;
  }

  const saved = await saveIngest(db, backgroundId, {
    imageKey: keys.imageKey,
    thumbKey: keys.thumbKey,
    width: size.width,
    height: size.height,
  });
  if (!saved.ok) {
    // Deleted (or failed by cleanup) while this ran: the files just written belong to nobody.
    await queueDeletions(db, [keys.sourceKey, keys.imageKey, keys.thumbKey]);
    return { outcome: "gone" };
  }
  return { outcome: "ready" };
}

export function realIo(r2: R2): IngestIo {
  return {
    head: (key) => r2.headObject(key),
    presignGet: (key) => r2.presignGet(key, { expiresSeconds: 3600 }),
    download: (url, path, signal) => downloadToFile(url, path, signal),
    readHead: async (path) => {
      const handle = await open(path, "r");
      try {
        const buffer = new Uint8Array(64);
        const { bytesRead } = await handle.read(buffer, 0, 64, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
    probe: async (path, signal) => {
      try {
        return await probeImageFile(path, BACKGROUND_IMAGE.maxPixels, signal);
      } catch (error) {
        // ffprobe could not read it at all: not an image. A timeout or the deadline is not.
        if (error instanceof MediaToolError && !error.timedOut) return null;
        throw error;
      }
    },
    convert: async (source, dir, facts, signal) => {
      await runFfmpeg(convertArgs(source, dir, facts), { timeoutMs: 120_000, signal });
    },
    put: async (key, path, contentType, signal) => {
      const bytes = await readFile(path);
      await r2.putObject(key, new Uint8Array(bytes), contentType, signal);
    },
  };
}

export const ingestBackgroundTask = task({
  id: "ingest-background",
  machine: "medium-1x",
  maxDuration: INGEST_BACKGROUND_LIMITS.maxDurationSeconds,
  retry: { maxAttempts: INGEST_BACKGROUND_LIMITS.maxAttempts },
  run: async (payload: { readonly backgroundId: string }) => {
    const env = parseJobEnv();
    const r2 = createR2(env);
    const dir = await mkdtemp(join(tmpdir(), "ingest-"));
    try {
      return await runWithDeadline(
        deadlineMs(INGEST_BACKGROUND_LIMITS.maxDurationSeconds),
        (signal) =>
          withJobDb(env.DATABASE_URL, async (db) => {
            const result = await ingestBackground(
              db,
              payload.backgroundId,
              realIo(r2),
              dir,
              signal,
            );
            // IDs and the outcome only.
            logger.info("ingest-background", { backgroundId: payload.backgroundId, ...result });
            return result;
          }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  onFailure: async ({ payload }) => {
    const env = parseJobEnv();
    await withJobDb(env.DATABASE_URL, (db) => failIngest(db, payload.backgroundId, "ingest_error"));
  },
});
