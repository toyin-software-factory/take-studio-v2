import type { Container } from "./processing";
import { MEDIA_LIMITS } from "./take-rules";

/**
 * Browser side upload rules (spec 0004, AC-2, AC-3): which files may start an upload, and the
 * retry timing for parts. Pure, so the upload area and its tests share one definition.
 */

/** What the browser knows about a chosen file. */
export type FileFacts = { readonly name: string; readonly size: number; readonly type: string };

export type FileCheck =
  | { readonly ok: true; readonly container: Container }
  | { readonly ok: false; readonly message: string };

const MIME_BY_CONTAINER: Readonly<Record<Container, string>> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

function extensionOf(name: string): Container | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "mp4" || ext === "mov" || ext === "webm" ? ext : null;
}

function containerOfMime(type: string): Container | null {
  if (type === MIME_BY_CONTAINER.mp4) return "mp4";
  if (type === MIME_BY_CONTAINER.mov) return "mov";
  // A recording's type carries its codecs: `video/webm;codecs=vp9,opus`.
  if (type.split(";")[0]?.trim() === MIME_BY_CONTAINER.webm) return "webm";
  return null;
}

/**
 * AC-2: refuse before upload a file over 2 GB, or one that isn't `.mp4`, `.mov` or `.webm`
 * (a browser recording). The MIME type must be `video/mp4`, `video/quicktime` or `video/webm`, or empty (some systems give none) with a
 * valid extension. A known MIME wins over the extension for the container.
 */
export function checkFile(file: FileFacts): FileCheck {
  const fromName = extensionOf(file.name);
  const fromMime = containerOfMime(file.type);
  const container = file.type === "" ? fromName : fromName && fromMime;
  if (!container) {
    return { ok: false, message: "This file isn't an MP4 or MOV video. Choose an MP4 or MOV." };
  }
  if (file.size <= 0) {
    return { ok: false, message: "This file is empty. Choose another video." };
  }
  if (file.size > MEDIA_LIMITS.maxBytes) {
    return { ok: false, message: "This video is over 2 GB. The limit is 2 GB." };
  }
  return { ok: true, container };
}

/** Upload attempts per part (AC-3): the first try plus up to 3 retries. */
export const PART_ATTEMPTS = 4;

/** Parts uploading at once (AC-3). */
export const PART_CONCURRENCY = 3;

/** Refresh a part link this long before it expires, so a slow part never starts on a dead one. */
export const LINK_REFRESH_MARGIN_MS = 60_000;

/** Wait before retry `attempt` (1, 2, 3): 1 s, 2 s, 4 s, capped at 8 s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 8000);
}

/** Byte range of part `partNumber` (1 based) for a file of `size` in parts of `partSize`. */
export function partRange(
  partNumber: number,
  size: number,
  partSize: number,
): { readonly start: number; readonly end: number } {
  const start = (partNumber - 1) * partSize;
  return { start, end: Math.min(start + partSize, size) };
}

/** Overall percent uploaded from the bytes sent per part, rounded down, 0 to 100. */
export function uploadPercent(sentPerPart: readonly number[], size: number): number {
  if (size <= 0) return 0;
  const sent = sentPerPart.reduce((sum, n) => sum + n, 0);
  return Math.min(100, Math.floor((sent / size) * 100));
}
