import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { background, user } from "@/db/schema";
import type { Executor } from "@/db/types";

/**
 * The backgrounds a creator can pick (spec 0008, AC-1, AC-9): the built in studios, then their
 * own uploads, newest first. Only built ins and the creator's own rows are ever returned. The
 * thumbnails are presigned by the caller; the files themselves are never public.
 */

export const MINE_LIMIT = 100;

export type BackgroundItem = {
  readonly id: string;
  readonly name: string;
  readonly alt: string;
  readonly status: string;
  /** Why ingest refused an upload (`image_too_small` ...), for the friendly message; null otherwise. */
  readonly failureCode: string | null;
  /** A presigned link for the 480 by 270 thumbnail; null until the image has been processed. */
  readonly thumbUrl: string | null;
};

export type BackgroundList = {
  readonly builtIn: readonly BackgroundItem[];
  readonly mine: readonly BackgroundItem[];
  /**
   * The creator's last pick (`user.default_background_id`), or null for "Keep original". Null
   * as well when that background was deleted or is not ready, so the upload area falls back.
   */
  readonly defaultId: string | null;
};

type Row = typeof background.$inferSelect;

export async function listBackgrounds(
  db: Executor,
  creatorId: string,
  presign: (key: string) => Promise<string>,
): Promise<BackgroundList> {
  const item = async (row: Row): Promise<BackgroundItem> => ({
    id: row.id,
    name: row.name,
    alt: row.alt ?? row.name,
    status: row.status,
    failureCode: row.failureCode,
    thumbUrl: row.status === "ready" && row.thumbKey ? await presign(row.thumbKey) : null,
  });

  const builtIn = await db
    .select()
    .from(background)
    .where(and(isNull(background.creatorId), eq(background.status, "ready")))
    .orderBy(background.createdAt, background.id);
  const mine = await db
    .select()
    .from(background)
    // Not the hidden tombstones of deleted uploads (`removed`).
    .where(
      and(
        eq(background.creatorId, creatorId),
        or(isNull(background.failureCode), ne(background.failureCode, "removed")),
      ),
    )
    .orderBy(desc(background.createdAt), desc(background.id))
    .limit(MINE_LIMIT);
  const [profile] = await db
    .select({ defaultId: user.defaultBackgroundId })
    .from(user)
    .where(eq(user.id, creatorId));

  const usable = [...builtIn, ...mine].find(
    (row) => row.id === profile?.defaultId && row.status === "ready",
  );
  return {
    builtIn: await Promise.all(builtIn.map(item)),
    mine: await Promise.all(mine.map(item)),
    defaultId: usable?.id ?? null,
  };
}
