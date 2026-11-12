import { z } from "zod";
import {
  beginProcessing,
  createBackgroundUpload,
  deleteBackground,
  failIngest,
  getOwnBackground,
} from "@/db/data/backgrounds";
import type { Db } from "@/db/types";
import { BACKGROUND_UPLOAD, backgroundKeys, isBackgroundContentType } from "@/lib/background-rules";
import { type Result, err, ok } from "@/lib/result";

/**
 * Uploading and deleting a creator's own backgrounds (spec 0008, AC-8 to AC-10). The browser
 * sends the image straight to R2 through a presigned PUT; the ingest task, not the browser,
 * decides whether it is a usable image. `creatorId` always comes from the session.
 */

export type UploadPorts = {
  readonly db: Db;
  /** A presigned PUT with the content type and exact length signed (15 minutes). */
  readonly presignPut: (key: string, contentType: string, bytes: number) => Promise<string>;
  readonly headObject: (key: string) => Promise<{ readonly size: number } | null>;
  /** Triggers `ingest-background` (key `ingest-{id}`). */
  readonly triggerIngest: (backgroundId: string) => Promise<unknown>;
  readonly now?: () => Date;
};

export type BackgroundUploadError =
  | "invalid"
  | "unsupported_type"
  | "too_large"
  | "rate_limited"
  | "library_full"
  | "not_found"
  | "not_uploaded"
  | "in_use"
  | "storage_error"
  | "dispatch_failed";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  contentType: z.string().min(1).max(100),
  bytes: z.number().int().positive(),
});

export async function createBackground(
  ports: UploadPorts,
  creatorId: string,
  input: unknown,
): Promise<Result<{ readonly id: string; readonly uploadUrl: string }, BackgroundUploadError>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return err("invalid");
  const { name, contentType, bytes } = parsed.data;
  if (!isBackgroundContentType(contentType)) return err("unsupported_type");
  if (bytes > BACKGROUND_UPLOAD.maxBytes) return err("too_large");

  const started = await createBackgroundUpload(ports.db, {
    creatorId,
    name,
    bytes,
    ...(ports.now ? { now: ports.now() } : {}),
  });
  if (!started.ok) return err(started.error);
  try {
    const uploadUrl = await ports.presignPut(started.data.sourceKey, contentType, bytes);
    return ok({ id: started.data.id, uploadUrl });
  } catch {
    // Nothing was handed out; cleanup fails the row if it is never completed.
    return err("storage_error");
  }
}

/** `/complete`: checks the file is stored, moves to `processing` and starts ingest. */
export async function completeBackground(
  ports: UploadPorts,
  creatorId: string,
  id: string,
): Promise<Result<{ readonly status: "processing" }, BackgroundUploadError>> {
  if (!z.uuid().safeParse(id).success) return err("not_found");
  const row = await getOwnBackground(ports.db, creatorId, id);
  if (!row) return err("not_found");
  if (row.status !== "uploading") return err("not_uploaded");

  let stored: { readonly size: number } | null;
  try {
    stored = await ports.headObject(backgroundKeys(creatorId, id).sourceKey);
  } catch {
    return err("storage_error");
  }
  // Nothing was uploaded: the creator can still send it and complete again.
  if (!stored) return err("not_uploaded");

  const moved = await beginProcessing(ports.db, creatorId, id);
  if (!moved.ok) return err(moved.error);
  try {
    await ports.triggerIngest(id);
  } catch {
    await failIngest(ports.db, id, "ingest_error");
    return err("dispatch_failed");
  }
  return ok({ status: "processing" });
}

export async function removeBackground(
  ports: Pick<UploadPorts, "db">,
  creatorId: string,
  id: string,
): Promise<Result<void, "not_found" | "in_use">> {
  if (!z.uuid().safeParse(id).success) return err("not_found");
  return deleteBackground(ports.db, creatorId, id);
}
