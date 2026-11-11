import type { Container } from "./processing";

/**
 * Upload and link constants for slice 1 (spec 0004). One place to tune them.
 */

const MiB = 1024 * 1024;

export const UPLOAD = {
  /** Browser upload part size: equal 16 MiB parts, the last one smaller. */
  partSize: 16 * MiB,
  /** Most part links one request may ask for. */
  maxPartsPerRequest: 50,
  /** Presigned part PUT links last 15 minutes. */
  partLinkSeconds: 15 * 60,
  /** Uploads a creator may start per hour. */
  perHourLimit: 10,
} as const;

export const MEDIA_LINKS = {
  /** Playback links (inline) last 1 hour. */
  playSeconds: 60 * 60,
  /** Download links (attachment) last 15 minutes. */
  downloadSeconds: 15 * 60,
} as const;

/** Render upload from jobs: 32 MiB parts, 3 attempts per part. */
export const RENDER_UPLOAD = { partSize: 32 * MiB, attempts: 3 } as const;

/** Number of upload parts for a file of `sizeBytes` (spec 0004 Value sourcing). */
export function partCount(sizeBytes: number, partSize: number = UPLOAD.partSize): number {
  return Math.max(1, Math.ceil(sizeBytes / partSize));
}

/** The Content-Type stored on an original upload. */
export function containerContentType(container: Container): string {
  return container === "mov" ? "video/quicktime" : "video/mp4";
}
