import * as z from "zod/mini";
import { UPLOAD } from "./uploads";

export type ApiReply = { readonly status: number; readonly data: unknown };

export type UploadIo = {
  /** JSON call to our API (same origin); rejects only on a network error. */
  readonly api: (path: string, method: "POST" | "DELETE", body?: unknown) => Promise<ApiReply>;
  /**
   * PUTs one part to its presigned link and resolves with its ETag (quotes stripped). Rejects
   * with a `PartError` on failure; aborts when `signal` fires.
   */
  readonly putPart: (
    url: string,
    body: Blob,
    onSent: (bytes: number) => void,
    signal: AbortSignal,
  ) => Promise<string>;
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
};

/** A failed part PUT; `status` 0 means a network error. */
export class PartError extends Error {
  constructor(readonly status: number) {
    super(`part upload failed (${status})`);
    this.name = "PartError";
  }
}

export type UploadPhase = "uploading" | "completing";

export type UploadEvents = {
  readonly onStarted?: (takeId: string) => void;
  readonly onProgress?: (percent: number) => void;
  readonly onPhase?: (phase: UploadPhase) => void;
};

export type UploadOutcome =
  | { readonly ok: true; readonly takeId: string }
  | { readonly ok: false; readonly reason: "cancelled" }
  | { readonly ok: false; readonly reason: "failed"; readonly message: string };

export const GENERIC_FAILURE = "The upload didn't go through. Check your connection and try again.";

export const errorBody = z.object({ message: z.string() });
export const createdBody = z.object({
  takeId: z.string(),
  partSize: z.number().check(z.int(), z.positive()),
  partCount: z.number().check(z.int(), z.positive()),
});
export const sizeMismatch = z.object({ error: z.literal("size_mismatch") });
export const linksBody = z.object({
  parts: z.array(z.object({ partNumber: z.int(), url: z.string() })),
  expiresInSeconds: z.number().check(z.positive()),
});

export function messageOf(reply: ApiReply): string {
  const parsed = errorBody.safeParse(reply.data);
  return parsed.success ? parsed.data.message : GENERIC_FAILURE;
}

export class UploadFailure extends Error {
  constructor(readonly friendly: string) {
    super(friendly);
    this.name = "UploadFailure";
  }
}

export type Link = { readonly url: string; readonly expiresAt: number };

/** Part numbers 1..n that still need a link, from `from`, at most one batch. */
export function batchFrom(from: number, count: number, has: (n: number) => boolean): number[] {
  const batch: number[] = [];
  for (let n = from; n <= count && batch.length < UPLOAD.maxPartsPerRequest; n += 1) {
    if (!has(n)) batch.push(n);
  }
  return batch;
}
