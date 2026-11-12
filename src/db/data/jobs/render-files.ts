import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { renderKey } from "@/lib/cut-rules";
import { render, storageDeletion } from "../../schema";
import type { Executor, Tx } from "../../types";

/**
 * Makes this job's newest succeeded render the take's latest (AC-10): the previous latest
 * loses `is_latest` and its `video_key`, and that key is queued for deletion in the same
 * transaction. Returns the queued keys. A no op when the job has no succeeded render or it
 * is already the latest. Shared with the renders data functions.
 */
export async function flipLatestRender(
  tx: Tx,
  input: { readonly takeId: string; readonly jobId: string },
): Promise<readonly string[]> {
  const [next] = await tx
    .select()
    .from(render)
    .where(
      and(
        eq(render.takeId, input.takeId),
        eq(render.jobId, input.jobId),
        eq(render.status, "succeeded"),
      ),
    )
    .orderBy(desc(render.createdAt))
    .limit(1)
    .for("update");
  if (!next || next.isLatest) return [];

  // Read and lock the old latest, then unset it before setting the new one: the partial
  // unique index allows one latest per take.
  const [previous] = await tx
    .select({ id: render.id, videoKey: render.videoKey })
    .from(render)
    .where(and(eq(render.takeId, input.takeId), eq(render.isLatest, true)))
    .for("update");
  const oldKeys = previous?.videoKey ? [previous.videoKey] : [];
  if (previous) {
    await tx
      .update(render)
      .set({ isLatest: false, videoKey: null })
      .where(eq(render.id, previous.id));
  }
  await queueDeletions(tx, oldKeys);

  await tx.update(render).set({ isLatest: true }).where(eq(render.id, next.id));
  return oldKeys;
}

/**
 * For a job that ended without success (AC-10): its renders never become the latest, so none
 * may keep a video file. Every non latest render of the job gets its `video_key` cleared and
 * its derived key (`renders/{takeId}/{renderId}.mp4`) queued for deletion, in the caller's
 * transaction. The derived key also covers a file uploaded before the render recorded
 * success; deleting a key that was never written is a no op. `pending` renders become
 * `failed`. Returns the queued keys.
 */
export async function discardJobRenders(
  tx: Tx,
  input: { readonly takeId: string; readonly jobId: string },
): Promise<readonly string[]> {
  const rows = await tx
    .select({ id: render.id, status: render.status })
    .from(render)
    .where(
      and(
        eq(render.takeId, input.takeId),
        eq(render.jobId, input.jobId),
        eq(render.isLatest, false),
      ),
    )
    .for("update");
  if (rows.length === 0) return [];

  const keys = rows.map((row) => renderKey(input.takeId, row.id));
  await queueDeletions(tx, keys);
  await tx
    .update(render)
    .set({
      videoKey: null,
      status: sql`case when ${render.status} = 'pending' then 'failed' else ${render.status} end`,
    })
    .where(
      inArray(
        render.id,
        rows.map((row) => row.id),
      ),
    );
  return keys;
}

/** Inserts `keys` into the storage deletion queue (same transaction as the row change). */
export async function queueDeletions(tx: Executor, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await tx
    .insert(storageDeletion)
    .values(keys.map((objectKey) => ({ id: crypto.randomUUID(), objectKey })));
}
