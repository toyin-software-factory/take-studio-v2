import type { Container } from "./processing";
import {
  GENERIC_FAILURE,
  type Link,
  PartError,
  type UploadEvents,
  UploadFailure,
  type UploadIo,
  type UploadOutcome,
  batchFrom,
  createdBody,
  linksBody,
  messageOf,
  sizeMismatch,
} from "./upload-client-parts";
import {
  LINK_REFRESH_MARGIN_MS,
  PART_ATTEMPTS,
  PART_CONCURRENCY,
  partRange,
  retryDelayMs,
  uploadPercent,
} from "./upload-rules";

/**
 * Browser direct multipart upload to R2 (spec 0004, Flow steps 1 to 3, AC-3): create the take,
 * fetch part links in batches, PUT equal parts 3 at a time with retries and fresh links when
 * one expires, then complete. The file never passes through the web app. All I/O is passed
 * in, so the orchestration is unit tested without a browser.
 *
 * Split (B2-T116): the shapes, the response schemas and the small helpers are in
 * `upload-client-parts`; this file keeps `uploadFile` and re-exports the public names.
 */
export {
  PartError,
  createdBody,
  errorBody,
  linksBody,
  sizeMismatch,
  type ApiReply,
  type UploadEvents,
  type UploadIo,
  type UploadOutcome,
  type UploadPhase,
} from "./upload-client-parts";

/** Uploads `file`. Resolves with the take ID, a cancellation, or a friendly failure. */
export async function uploadFile(
  file: Blob & { readonly name: string },
  container: Container,
  io: UploadIo,
  signal: AbortSignal,
  events: UploadEvents = {},
  /** Spec 0008, AC-1: a background ID or `original`; left out means no choice was made. */
  backgroundId?: string,
  /** Spec 0021: a browser recording says so and may carry the creator's script. */
  recording?: { readonly script: string; readonly durationMs?: number },
): Promise<UploadOutcome> {
  let takeId: string | null = null;
  try {
    const created = await io.api("/api/uploads", "POST", {
      fileName: file.name,
      sizeBytes: file.size,
      container,
      ...(backgroundId === undefined ? {} : { backgroundId }),
      ...(recording === undefined
        ? {}
        : {
            source: "recording",
            // Advisory: lets the server refuse a take longer than the minutes left (spec 0014).
            ...(recording.durationMs !== undefined && recording.durationMs > 0
              ? { durationHintMs: Math.round(recording.durationMs) }
              : {}),
            ...(recording.script.trim() === "" ? {} : { script: recording.script }),
          }),
    });
    if (created.status !== 201) throw new UploadFailure(messageOf(created));
    const plan = createdBody.safeParse(created.data);
    if (!plan.success) throw new UploadFailure(GENERIC_FAILURE);
    const { partSize, partCount } = plan.data;
    const id = plan.data.takeId;
    takeId = id;
    events.onStarted?.(id);
    events.onPhase?.("uploading");
    if (signal.aborted) throw signal.reason;

    // Links: cached per part, fetched in batches; one request in flight per batch.
    const links = new Map<number, Link>();
    const inFlight = new Map<number, Promise<void>>();
    const fresh = (n: number) => {
      const link = links.get(n);
      return link !== undefined && link.expiresAt - LINK_REFRESH_MARGIN_MS > io.now();
    };
    const fetchBatch = async (numbers: readonly number[]) => {
      const reply = await io.api(`/api/uploads/${id}/parts`, "POST", { partNumbers: numbers });
      if (reply.status !== 200) throw new UploadFailure(messageOf(reply));
      const parsed = linksBody.safeParse(reply.data);
      if (!parsed.success) throw new UploadFailure(GENERIC_FAILURE);
      const expiresAt = io.now() + parsed.data.expiresInSeconds * 1000;
      for (const part of parsed.data.parts)
        links.set(part.partNumber, { url: part.url, expiresAt });
    };
    const linkFor = async (n: number): Promise<string> => {
      if (!fresh(n)) {
        let pending = inFlight.get(n);
        if (!pending) {
          const batch = batchFrom(n, partCount, (m) => fresh(m) || inFlight.has(m));
          pending = fetchBatch(batch).finally(() => batch.forEach((m) => inFlight.delete(m)));
          batch.forEach((m) => inFlight.set(m, pending!));
        }
        await pending;
      }
      const link = links.get(n);
      if (!link) throw new UploadFailure(GENERIC_FAILURE);
      return link.url;
    };

    // When one worker gives up, the others are stopped and awaited before this returns, so a
    // late progress callback can't touch the next upload's percentage.
    const stop = new AbortController();
    const workSignal = AbortSignal.any([signal, stop.signal]);

    const sent: number[] = Array.from({ length: partCount }, () => 0);
    const etags: string[] = Array.from({ length: partCount }, () => "");
    const report = () => events.onProgress?.(uploadPercent(sent, file.size));

    const uploadPart = async (n: number) => {
      const { start, end } = partRange(n, file.size, partSize);
      const body = file.slice(start, end);
      for (let attempt = 1; ; attempt += 1) {
        try {
          const url = await linkFor(n);
          etags[n - 1] = await io.putPart(
            url,
            body,
            (bytes) => {
              sent[n - 1] = bytes;
              report();
            },
            workSignal,
          );
          sent[n - 1] = end - start;
          report();
          return;
        } catch (error) {
          if (workSignal.aborted || error instanceof UploadFailure) throw error;
          sent[n - 1] = 0;
          report();
          if (attempt >= PART_ATTEMPTS) throw new UploadFailure(GENERIC_FAILURE);
          // R2 answers 403 to an expired link: drop it so the retry asks for a new one.
          if (error instanceof PartError && error.status === 403) links.delete(n);
          await io.sleep(retryDelayMs(attempt), workSignal);
        }
      }
    };

    let next = 1;
    const failures: unknown[] = [];
    const worker = async () => {
      try {
        while (next <= partCount && !workSignal.aborted) {
          const n = next;
          next += 1;
          await uploadPart(n);
        }
      } catch (error) {
        failures.push(error);
        stop.abort();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, worker));
    // The first failure is the cause; the rest are the others being stopped.
    if (failures.length > 0) throw failures[0];

    events.onPhase?.("completing");
    const parts = etags.map((etag, i) => ({ partNumber: i + 1, etag }));
    // Complete is idempotent, so a storage hiccup or a failed probe dispatch is retried.
    for (let attempt = 1; ; attempt += 1) {
      if (signal.aborted) throw signal.reason;
      const done = await io.api(`/api/uploads/${id}/complete`, "POST", { parts });
      if (done.status === 200) return { ok: true, takeId: id };
      if (done.status !== 503 || attempt >= PART_ATTEMPTS) {
        // The server failed the take itself on a size mismatch, so there is nothing left to
        // abandon. Any other refusal (bad_parts, a retry limit) leaves the take uploading.
        if (done.status === 422 && sizeMismatch.safeParse(done.data).success) takeId = null;
        throw new UploadFailure(messageOf(done));
      }
      await io.sleep(retryDelayMs(attempt), signal);
    }
  } catch (error) {
    if (takeId) await abandon(io, takeId);
    if (signal.aborted) return { ok: false, reason: "cancelled" };
    return {
      ok: false,
      reason: "failed",
      message: error instanceof UploadFailure ? error.friendly : GENERIC_FAILURE,
    };
  }
}

/** Tells the server the upload stopped (aborts the multipart upload); best effort. */
async function abandon(io: UploadIo, takeId: string): Promise<void> {
  try {
    await io.api(`/api/uploads/${takeId}`, "DELETE");
  } catch {
    // Offline: the cleanup task fails the take later (spec 0004, Consequences).
  }
}
