import {} from "zod";
import { queueDeletions } from "@/db/data/jobs";
import { touchUploading, transitionTake } from "@/db/data/takes";
import { runTx } from "@/db/tx";
import type { Take } from "@/db/types";
import { uploadCompleteSchema, uploadPartsSchema } from "@/lib/api-schemas/requests";
import { CLEANUP } from "@/lib/cleanup-rules";
import {} from "@/lib/processing";
import { R2CompleteError } from "@/lib/r2";
import { type Result, err, ok } from "@/lib/result";
import {} from "@/lib/take-rules";
import { UPLOAD, partCount } from "@/lib/uploads";
import { recordEvent } from "../analytics/record";
import { type UploadDeps, type UploadError, ownedTake } from "./base";

/**
 * `POST /api/uploads/{takeId}/parts`: presigned PUT links (15 minutes) for part numbers within
 * the take's part count, only while it is still uploading.
 */
export async function presignParts(
  deps: UploadDeps,
  creatorId: string,
  takeId: string,
  input: unknown,
): Promise<
  Result<
    {
      readonly parts: readonly { partNumber: number; url: string }[];
      readonly expiresInSeconds: number;
    },
    UploadError
  >
> {
  const t = await ownedTake(deps.db, creatorId, takeId);
  if (!t) return err("not_found");
  if (t.status !== "uploading" || !t.uploadId) return err("not_uploading");
  const parsed = uploadPartsSchema.safeParse(input);
  if (!parsed.success) return err("bad_parts");
  const total = partCount(t.originalBytes);
  if (parsed.data.partNumbers.some((n) => n > total)) return err("bad_parts");

  // The creator is still sending: note it, so the cleanup does not call a slow upload idle.
  await touchUploading(deps.db, t.id, deps.now?.() ?? new Date(), CLEANUP.uploadTouchEveryMs);
  const uploadId = t.uploadId;
  const parts = await Promise.all(
    parsed.data.partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await deps.r2.presignUploadPart(
        t.originalKey,
        uploadId,
        partNumber,
        UPLOAD.partLinkSeconds,
      ),
    })),
  );
  return ok({ parts, expiresInSeconds: UPLOAD.partLinkSeconds });
}

/** Statuses a take reaches only after its upload completed. */
const AFTER_UPLOAD = new Set(["uploaded", "processing", "ready", "expired"]);

/**
 * `POST /api/uploads/{takeId}/complete`: validates the part list (exactly `partCount` parts,
 * numbered 1..n in order, non empty ETags), completes the multipart upload, checks the stored
 * size against the declared size (a mismatch fails the take with `corrupt_upload`), then
 * dispatches the probe. Idempotent: a repeat call after completion returns the current status,
 * and the probe dispatch is keyed `probe-{takeId}`.
 */
export async function completeUpload(
  deps: UploadDeps,
  creatorId: string,
  takeId: string,
  input: unknown,
): Promise<Result<{ readonly takeId: string; readonly status: Take["status"] }, UploadError>> {
  const t = await ownedTake(deps.db, creatorId, takeId);
  if (!t) return err("not_found");
  if (AFTER_UPLOAD.has(t.status)) return ok({ takeId: t.id, status: t.status });
  if (t.status !== "uploading" || !t.uploadId) return err("not_uploading");

  const parsed = uploadCompleteSchema.safeParse(input);
  if (!parsed.success) return err("bad_parts");
  const parts = parsed.data.parts.map((p) => ({
    partNumber: p.partNumber,
    etag: p.etag.replaceAll('"', "").trim(),
  }));
  const total = partCount(t.originalBytes);
  const wellFormed =
    parts.length === total && parts.every((p, i) => p.partNumber === i + 1 && p.etag.length > 0);
  if (!wellFormed) return err("bad_parts");

  try {
    await deps.r2.completeMultipartUpload(t.originalKey, t.uploadId, parts);
  } catch (error) {
    // NoSuchUpload: an earlier call already completed it; the HEAD below decides.
    const code = error instanceof R2CompleteError ? error.code : null;
    if (code === "InvalidPart" || code === "InvalidPartOrder" || code === "EntityTooSmall") {
      return err("bad_parts");
    }
    if (code !== "NoSuchUpload") return err("storage_error");
  }

  let stored: { readonly size: number } | null;
  try {
    stored = await deps.r2.headObject(t.originalKey);
  } catch {
    return err("storage_error");
  }
  if (!stored) return err("bad_parts");
  if (stored.size !== t.originalBytes) {
    await runTx(deps.db, async (tx) => {
      const failed = await transitionTake(tx, t.id, "uploading", "failed", {
        failureCode: "corrupt_upload",
        uploadId: null,
      });
      if (failed.ok) await queueDeletions(tx, [t.originalKey]);
      return failed;
    });
    return err("size_mismatch");
  }

  // Spec 0016 AC-4: the upload is complete in storage. Counted before the probe, so a take the
  // probe later rejects is still an upload; once per take, so a repeated complete is skipped.
  await recordEvent(deps.db, { name: "take_uploaded", creatorId, takeId: t.id });

  try {
    await deps.dispatchProbe(t.id);
  } catch {
    // Safe to call complete again: the upload is done and the dispatch is idempotent.
    return err("dispatch_failed");
  }
  return ok({ takeId: t.id, status: "uploading" });
}

/**
 * `DELETE /api/uploads/{takeId}`: the creator cancels an upload in progress. Aborts the
 * multipart upload (freeing its parts), then fails the take with `upload_abandoned`.
 * An upload that already completed (the object exists) is not cancelled: 409.
 */
export async function abortUpload(
  deps: UploadDeps,
  creatorId: string,
  takeId: string,
): Promise<Result<{ readonly takeId: string }, UploadError>> {
  const t = await ownedTake(deps.db, creatorId, takeId);
  if (!t) return err("not_found");
  if (t.status !== "uploading") return err("not_uploading");

  try {
    // complete may have finished while the take is still `uploading` (the probe hasn't run
    // yet). Then there's nothing to cancel: the spec's 409 "already completed".
    if (await deps.r2.headObject(t.originalKey)) return err("not_uploading");
    if (t.uploadId) await deps.r2.abortMultipartUpload(t.originalKey, t.uploadId);
  } catch {
    return err("storage_error");
  }
  const failed = await transitionTake(deps.db, t.id, "uploading", "failed", {
    failureCode: "upload_abandoned",
    uploadId: null,
  });
  return failed.ok ? ok({ takeId: t.id }) : err("not_uploading");
}
