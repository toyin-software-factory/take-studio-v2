import { open, stat } from "node:fs/promises";
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

/** Runs `fn` up to `attempts` times, waiting `backoffMs * 2^n` between tries. */
async function withRetry<T>(fn: () => Promise<T>, attempts: number, backoffMs: number): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * 2 ** (attempt - 1)));
    }
  }
}
