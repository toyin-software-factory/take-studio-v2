import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { render, take } from "@/db/schema";
import type { Executor } from "@/db/types";
import { type TakeStatus } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";

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
