import { and, asc, desc, eq, gt, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type DeletedTakes, deleteTakesInTx } from "@/db/data/deletion";
import { markUploaded, transition } from "@/db/data/takes";
import { jobStep, processingJob, render, take } from "@/db/schema";
import { runTx } from "@/db/tx";
import type { Executor, JobStep, ProcessingJob, Render, Take } from "@/db/types";
import { CONTAINERS, TAKE_TITLE_MAX, type TakeStatus } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { MEDIA_LIMITS, cleanTitle, originalKey, titleFromFileName } from "@/lib/take-rules";
import { cancelRuns, requestStorageDrain } from "@/lib/trigger-runs";

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
});

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
  const { creatorId, fileName, container, bytes } = parsed.data;

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

export type TakeDetail = {
  readonly take: Take;
  readonly latestRender: Render | null;
  readonly latestJob: (ProcessingJob & { readonly steps: readonly JobStep[] }) | null;
};

/** `takes.getForCreator`: the take with its latest render and latest job (with steps). */
export async function getForCreator(
  db: Executor,
  creatorId: string,
  takeId: string,
): Promise<Result<TakeDetail, "not_found">> {
  if (!z.uuid().safeParse(takeId).success) return err("not_found");
  const [found] = await db
    .select()
    .from(take)
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)));
  if (!found) return err("not_found");

  const [latestRender] = await db
    .select()
    .from(render)
    .where(and(eq(render.takeId, takeId), eq(render.isLatest, true)));
  const [latestJob] = await db
    .select()
    .from(processingJob)
    // Transcribe jobs have their own panel; the progress view follows video jobs only.
    .where(and(eq(processingJob.takeId, takeId), ne(processingJob.kind, "transcribe")))
    .orderBy(desc(processingJob.createdAt))
    .limit(1);
  const steps = latestJob
    ? await db
        .select()
        .from(jobStep)
        .where(eq(jobStep.jobId, latestJob.id))
        .orderBy(asc(jobStep.position))
    : [];

  return ok({
    take: found,
    latestRender: latestRender ?? null,
    latestJob: latestJob ? { ...latestJob, steps } : null,
  });
}

export type TakeListRow = {
  readonly id: string;
  readonly title: string;
  readonly status: TakeStatus;
  readonly durationMs: number | null;
  readonly videoExpiresAt: Date | null;
  readonly createdAt: Date;
  /** Why a failed take failed (AC-10 card message and "Try again"); null otherwise. */
  readonly failureCode: string | null;
  readonly latestRenderId: string | null;
  readonly latestRenderDurationMs: number | null;
};

export const LIST_LIMIT_MAX = 50;

/**
 * The cursor is the last row's `created_at` as Postgres text (microsecond precision, which a
 * JS Date would lose) plus its ID, base64url encoded. Opaque to callers.
 */
const cursorSchema = z.object({ at: z.string().min(1), id: z.uuid() });
type Cursor = z.infer<typeof cursorSchema>;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString()));
    return parsed.success && !Number.isNaN(Date.parse(parsed.data.at)) ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * `takes.listForCreator`: the creator's takes, newest first, `limit` (1 to 50) per page, with
 * each take's latest render. Pass the returned `nextCursor` for the next page; null means
 * the end. A malformed cursor is `invalid`.
 */
export async function listForCreator(
  db: Executor,
  creatorId: string,
  options: { readonly cursor?: string | null; readonly limit?: number } = {},
): Promise<
  Result<{ readonly rows: readonly TakeListRow[]; readonly nextCursor: string | null }, "invalid">
> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), LIST_LIMIT_MAX);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (options.cursor && !cursor) return err("invalid");

  // Matches the index (creator_id, created_at desc, id): newest first, ties by id.
  const after = cursor
    ? or(
        lt(take.createdAt, sql`${cursor.at}::timestamptz`),
        and(eq(take.createdAt, sql`${cursor.at}::timestamptz`), gt(take.id, cursor.id)),
      )
    : undefined;

  const rows = await db
    .select({
      id: take.id,
      title: take.title,
      status: take.status,
      durationMs: take.durationMs,
      videoExpiresAt: take.videoExpiresAt,
      createdAt: take.createdAt,
      failureCode: take.failureCode,
      createdAtText: sql<string>`${take.createdAt}::text`,
      latestRenderId: render.id,
      latestRenderDurationMs: render.durationMs,
    })
    .from(take)
    .leftJoin(render, and(eq(render.takeId, take.id), eq(render.isLatest, true)))
    .where(and(eq(take.creatorId, creatorId), after))
    .orderBy(desc(take.createdAt), asc(take.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ at: last.createdAtText, id: last.id }) : null;
  return ok({
    rows: page.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      durationMs: row.durationMs,
      videoExpiresAt: row.videoExpiresAt,
      createdAt: row.createdAt,
      failureCode: row.failureCode,
      latestRenderId: row.latestRenderId,
      latestRenderDurationMs: row.latestRenderDurationMs,
    })),
    nextCursor,
  });
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

/** Side effects run after a deletion commits; injectable for tests. */
export type AfterDelete = {
  readonly cancelRuns: (runIds: readonly string[]) => Promise<unknown>;
  readonly requestStorageDrain: () => Promise<unknown>;
};

const defaultAfterDelete: AfterDelete = { cancelRuns, requestStorageDrain };

/**
 * `deleteTake` (AC-17): deletes the creator's take and everything under it (jobs, steps, cuts,
 * renders cascade), queuing every file key in the same transaction. After commit it cancels
 * the take's active Trigger.dev runs and asks for a queue drain, both best effort.
 */
export async function deleteTake(
  db: Executor,
  creatorId: string,
  takeId: string,
  after: AfterDelete = defaultAfterDelete,
): Promise<Result<DeletedTakes, "not_found">> {
  if (!z.uuid().safeParse(takeId).success) return err("not_found");

  const result = await runTx(db, async (tx) => {
    const [owned] = await tx
      .select({ id: take.id })
      .from(take)
      .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)))
      .for("update");
    if (!owned) return err("not_found");
    return ok(await deleteTakesInTx(tx, [takeId]));
  });

  if (result.ok) {
    await after.cancelRuns(result.data.runIds);
    await after.requestStorageDrain();
  }
  return result;
}
