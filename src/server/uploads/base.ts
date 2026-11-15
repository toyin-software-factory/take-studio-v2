import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {} from "@/db/data/jobs";
import { take } from "@/db/schema";
import {} from "@/db/tx";
import type { Db, Take } from "@/db/types";
import {} from "@/lib/cleanup-rules";
import {} from "@/lib/processing";
import { type R2 } from "@/lib/r2";
import {} from "@/lib/take-rules";
import {} from "../analytics/record";

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
  /** Spec 0021: the script is over 20000 characters. */
  | "script_too_long"
  | "too_large"
  | "rate_limited"
  | "not_found"
  | "not_uploading"
  | "bad_parts"
  | "size_mismatch"
  | "storage_error"
  | "dispatch_failed"
  | "background_not_found"
  | "background_not_ready";

export type CreatedUpload = {
  readonly takeId: string;
  readonly partSize: number;
  readonly partCount: number;
};

/** The creator's take, or null. Malformed IDs are simply not found. */
export async function ownedTake(db: Db, creatorId: string, takeId: string): Promise<Take | null> {
  if (!z.uuid().safeParse(takeId).success) return null;
  const [found] = await db
    .select()
    .from(take)
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)));
  return found ?? null;
}
