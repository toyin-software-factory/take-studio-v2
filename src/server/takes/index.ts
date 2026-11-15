import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { markUploaded, transition } from "@/db/data/takes";
import { take } from "@/db/schema";
import type { Executor, Take } from "@/db/types";
import { CONTAINERS, SCRIPT_MAX_CHARS, TAKE_SOURCES, TAKE_TITLE_MAX } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { MEDIA_LIMITS, cleanTitle, originalKey, titleFromFileName } from "@/lib/take-rules";

/**
 * Creator scoped take functions (spec 0002, API surface; AC-2). `creatorId` always comes
 * from the Better Auth session, never from the request body. Another creator's take is
 * `not_found`, never `forbidden`, so IDs leak nothing.
 */

// System functions, re exported so callers see one `takes` surface.
export { expireTake as expire } from "@/db/data/deletion";
export { markUploaded, transition };

const createSchema = z.object({
  creatorId: z.string().min(1),
  fileName: z.string(),
  container: z.enum(CONTAINERS),
  bytes: z.number().int().positive().max(MEDIA_LIMITS.maxBytes),
  /** Spec 0021: where the video came from; left out means a file upload. */
  source: z.enum(TAKE_SOURCES).optional(),
  /** Spec 0021: the creator's script, trimmed; empty means none. Personal data, never logged. */
  script: z
    .string()
    .max(SCRIPT_MAX_CHARS * 2)
    .optional(),
});

/** The script as stored: trimmed, and null when empty or absent. */
export function cleanScript(script: string | undefined | null): string | null {
  const trimmed = script?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * `takes.create`: a new take in `uploading` with an app generated ID and its original key
 * (`originals/{takeId}/source.{container}`). The title comes from the file name.
 * Upload flow: create → start the multipart upload at `originalKey` → `attachUpload`.
 */
export async function create(
  db: Executor,
  input: z.input<typeof createSchema>,
): Promise<Result<Take, "invalid">> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return err("invalid");
  const { creatorId, fileName, container, bytes, source, script } = parsed.data;
  const cleanedScript = cleanScript(script);
  if (cleanedScript !== null && cleanedScript.length > SCRIPT_MAX_CHARS) return err("invalid");

  const title = titleFromFileName(fileName);
  if (title.length === 0) return err("invalid");

  const id = crypto.randomUUID();
  const [created] = await db
    .insert(take)
    .values({
      id,
      creatorId,
      title,
      status: "uploading",
      originalKey: originalKey(id, container),
      originalBytes: bytes,
      container,
      source: source ?? "file",
      script: cleanedScript,
    })
    .returning();
  return created ? ok(created) : err("invalid");
}

/**
 * `takes.attachUpload`: stores the multipart upload ID on the creator's take, only while it
 * is still `uploading` (the cleanup task uses it to abort abandoned uploads). A take in any
 * other status is `invalid_transition`; another creator's take is `not_found`.
 */
export async function attachUpload(
  db: Executor,
  creatorId: string,
  takeId: string,
  uploadId: string,
): Promise<Result<Take, "not_found" | "invalid" | "invalid_transition">> {
  if (!z.uuid().safeParse(takeId).success) return err("not_found");
  if (!z.string().trim().min(1).max(1024).safeParse(uploadId).success) return err("invalid");

  const [updated] = await db
    .update(take)
    .set({ uploadId })
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId), eq(take.status, "uploading")))
    .returning();
  if (updated) return ok(updated);

  const [owned] = await db
    .select({ id: take.id })
    .from(take)
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)));
  return err(owned ? "invalid_transition" : "not_found");
}

/** `takes.rename`: any status, including `expired`. Title cleaned, 1 to 200 characters. */
export async function rename(
  db: Executor,
  creatorId: string,
  takeId: string,
  rawTitle: string,
): Promise<Result<Take, "not_found" | "invalid">> {
  if (!z.uuid().safeParse(takeId).success) return err("not_found");
  const title = cleanTitle(rawTitle);
  if (title.length === 0 || [...title].length > TAKE_TITLE_MAX) return err("invalid");

  const [updated] = await db
    .update(take)
    .set({ title })
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)))
    .returning();
  return updated ? ok(updated) : err("not_found");
}

// Split by job (B2-T117): the detail read is in `detail`, the list in `list` and deletion in
// `remove`. This file keeps the import path stable.
export { aiEditState, getForCreator, type AiEditState, type TakeDetail } from "./detail";
export { LIST_LIMIT_MAX, listForCreator, type TakeListRow } from "./list";
export { deleteTake, type AfterDelete } from "./remove";
