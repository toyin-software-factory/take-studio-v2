import { and, count, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { queueDeletions } from "@/db/data/jobs";
import { transitionTake } from "@/db/data/takes";
import { take, user } from "@/db/schema";
import { runTx } from "@/db/tx";
import type { Db, Take } from "@/db/types";
import { CONTAINERS } from "@/lib/processing";
import { R2CompleteError, type R2 } from "@/lib/r2";
import { type Result, err, ok } from "@/lib/result";
import { MEDIA_LIMITS } from "@/lib/take-rules";
import { UPLOAD, containerContentType, partCount } from "@/lib/uploads";
import { attachUpload, create } from "../takes";

/**
 * Browser direct multipart upload to R2 (spec 0004, Flow steps 1 to 3; AC-3, AC-4, AC-12).
 * The web app never touches file bytes: it creates the multipart upload, hands out short
 * lived part links, then completes, checks the stored size and dispatches the probe.
 * `creatorId` always comes from the session.
 */

export type UploadDeps = {
  readonly db: Db;
  readonly r2: Pick<
    R2,
    | "createMultipartUpload"
    | "presignUploadPart"
    | "completeMultipartUpload"
    | "abortMultipartUpload"
    | "headObject"
  >;
  /** Triggers the probe task with idempotency key `probe-{takeId}`. */
  readonly dispatchProbe: (takeId: string) => Promise<void>;
  readonly now?: () => Date;
};

export type UploadError =
  | "invalid"
  | "too_large"
  | "rate_limited"
  | "not_found"
  | "not_uploading"
  | "bad_parts"
  | "size_mismatch"
  | "storage_error"
  | "dispatch_failed";

const createSchema = z.object({
  fileName: z.string().min(1).max(1000),
  sizeBytes: z.number().int().positive(),
  container: z.enum(CONTAINERS),
});

export type CreatedUpload = {
  readonly takeId: string;
  readonly partSize: number;
  readonly partCount: number;
};

/**
 * `POST /api/uploads`: checks the hourly limit, creates the take (`uploading`), starts the R2
 * multipart upload for its original key and attaches the upload ID.
 */
export async function createUpload(
  deps: UploadDeps,
  creatorId: string,
  input: unknown,
): Promise<Result<CreatedUpload, UploadError>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return err("invalid");
  const { fileName, sizeBytes, container } = parsed.data;
  if (sizeBytes > MEDIA_LIMITS.maxBytes) return err("too_large");
  const now = deps.now?.() ?? new Date();

  // Lock the creator's row so parallel requests can't both slip under the limit.
  const created = await runTx(deps.db, async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, creatorId)).for("update");
    const [recent] = await tx
      .select({ n: count() })
      .from(take)
      .where(
        and(eq(take.creatorId, creatorId), gt(take.createdAt, new Date(now.getTime() - 3_600_000))),
      );
    if ((recent?.n ?? 0) >= UPLOAD.perHourLimit) return err("rate_limited" as const);
    const made = await create(tx, { creatorId, fileName, container, bytes: sizeBytes });
    return made.ok ? ok(made.data) : err("invalid" as const);
  });
  if (!created.ok) return created;
  const t = created.data;

  let uploadId: string;
  try {
    uploadId = await deps.r2.createMultipartUpload(t.originalKey, containerContentType(container));
  } catch {
    await transitionTake(deps.db, t.id, "uploading", "failed", { failureCode: "internal_error" });
    return err("storage_error");
  }
  const attached = await attachUpload(deps.db, creatorId, t.id, uploadId);
  if (!attached.ok) return err("storage_error");

  return ok({ takeId: t.id, partSize: UPLOAD.partSize, partCount: partCount(sizeBytes) });
}

/** The creator's take, or null. Malformed IDs are simply not found. */
async function ownedTake(db: Db, creatorId: string, takeId: string): Promise<Take | null> {
  if (!z.uuid().safeParse(takeId).success) return null;
  const [found] = await db
    .select()
    .from(take)
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)));
  return found ?? null;
}

const partsRequestSchema = z.object({
  partNumbers: z
    .array(z.number().int().positive())
    .min(1)
    .max(UPLOAD.maxPartsPerRequest)
    .refine((list) => new Set(list).size === list.length, "duplicate part numbers"),
});

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
  const parsed = partsRequestSchema.safeParse(input);
  if (!parsed.success) return err("bad_parts");
  const total = partCount(t.originalBytes);
  if (parsed.data.partNumbers.some((n) => n > total)) return err("bad_parts");

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

const completeSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), etag: z.string() }))
    .min(1)
    .max(10_000),
});

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

  const parsed = completeSchema.safeParse(input);
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
