import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { markUploaded, transition } from "@/db/data/takes";
import { jobStep, processingJob, render, take } from "@/db/schema";
import type { Executor, JobStep, ProcessingJob, Render, Take } from "@/db/types";
import { CONTAINERS, TAKE_TITLE_MAX, type TakeStatus } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { MEDIA_LIMITS, cleanTitle, originalKey, titleFromFileName } from "@/lib/take-rules";

/**
 * Creator scoped take functions (spec 0002, API surface; AC-2). `creatorId` always comes
 * from the Better Auth session, never from the request body. Another creator's take is
 * `not_found`, never `forbidden`, so IDs leak nothing.
 */

// System functions, re exported so callers see one `takes` surface.
export { markUploaded, transition };

const createSchema = z.object({
  creatorId: z.string().min(1),
  fileName: z.string(),
  container: z.enum(CONTAINERS),
  bytes: z.number().int().positive().max(MEDIA_LIMITS.maxBytes),
  uploadId: z.string().min(1).nullable().optional(),
});

/**
 * `takes.create`: a new take in `uploading` with an app generated ID and its original key
 * (`originals/{takeId}/source.{container}`). The title comes from the file name.
 */
export async function create(
  db: Executor,
  input: z.input<typeof createSchema>,
): Promise<Result<Take, "invalid">> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return err("invalid");
  const { creatorId, fileName, container, bytes, uploadId } = parsed.data;

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
      uploadId: uploadId ?? null,
    })
    .returning();
  return created ? ok(created) : err("invalid");
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
    .where(eq(processingJob.takeId, takeId))
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
