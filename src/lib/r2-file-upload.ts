import { createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { RENDER_UPLOAD } from "./uploads";

/**
 * Job side multipart upload of a local file to R2 (spec 0004, render upload). Node only
 * (reads from disk), so it lives apart from `r2.ts`, which the Worker also bundles.
 */

/** The R2 calls this uploader needs (see `createR2`). */
export type MultipartTarget = {
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array<ArrayBuffer>,
  ): Promise<string>;
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly { readonly partNumber: number; readonly etag: string }[],
  ): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
};

type UploadOptions = {
  readonly contentType: string;
  readonly partSize?: number;
  /** Attempts per part, with backoff between them. */
  readonly attempts?: number;
  /** Parts in flight at once. */
  readonly concurrency?: number;
  /** Backoff base in ms (1x, 2x, 4x…). */
  readonly backoffMs?: number;
  /**
   * The job deadline: no new part or retry starts once it aborts (a part already in flight
   * finishes), the multipart upload is aborted, and the signal's reason is thrown.
   */
  readonly signal?: AbortSignal;
};

/**
 * Uploads `filePath` to `key` in parts, a few at a time, retrying each part. On a final
 * failure the multipart upload is aborted (so no parts linger) and the error is rethrown.
 * Returns the uploaded size in bytes.
 */
export async function uploadFileMultipart(
  r2: MultipartTarget,
  key: string,
  filePath: string,
  options: UploadOptions,
): Promise<number> {
  const partSize = options.partSize ?? RENDER_UPLOAD.partSize;
  const attempts = options.attempts ?? RENDER_UPLOAD.attempts;
  const concurrency = options.concurrency ?? 3;
  const backoffMs = options.backoffMs ?? 1_000;

  const { size } = await stat(filePath);
  const count = Math.max(1, Math.ceil(size / partSize));
  const uploadId = await r2.createMultipartUpload(key, options.contentType);
  const file = await open(filePath, "r");

  try {
    const etags = new Array<string>(count);
    let next = 0;
    // Set on the first failure, so the other workers stop taking parts.
    let stopped = false;
    const worker = async () => {
      while (!stopped && next < count) {
        options.signal?.throwIfAborted();
        const index = next++;
        const start = index * partSize;
        const length = Math.min(partSize, size - start);
        const buffer = new Uint8Array(new ArrayBuffer(length));
        try {
          const { bytesRead } = await file.read(buffer, 0, length, start);
          // A file that shrank mid upload must not send a zero padded part.
          if (bytesRead !== length) throw new Error("render file changed during upload");
          etags[index] = await withRetry(
            () => r2.uploadPart(key, uploadId, index + 1, buffer),
            attempts,
            backoffMs,
            options.signal,
          );
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    };
    // Wait for every worker to stop before aborting or closing the file.
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(concurrency, count) }, worker),
    );
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) throw failure.reason;
    await r2.completeMultipartUpload(
      key,
      uploadId,
      etags.map((etag, i) => ({ partNumber: i + 1, etag })),
    );
    return size;
  } catch (error) {
    await r2.abortMultipartUpload(key, uploadId).catch(() => {});
    throw error;
  } finally {
    await file.close();
  }
}

/** Waits `ms`, or ends early with the signal's reason when it aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Runs `fn` up to `attempts` times, waiting `backoffMs * 2^n` between tries. */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  backoffMs: number,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    // Never start another attempt once the deadline has fired.
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt >= attempts) throw error;
      await sleep(backoffMs * 2 ** (attempt - 1), signal);
    }
  }
}

/**
 * Streams a presigned GET to a local file (never into memory). Errors carry the HTTP status,
 * never the URL. Returns the bytes written.
 */
export async function downloadToFile(
  url: string,
  path: string,
  signal?: AbortSignal,
): Promise<number> {
  const limit = AbortSignal.timeout(30 * 60_000);
  const res = await fetch(url, { signal: signal ? AbortSignal.any([limit, signal]) : limit });
  if (!res.ok || !res.body) throw new Error(`R2 download failed: HTTP ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream),
    createWriteStream(path),
  );
  return (await stat(path)).size;
}
