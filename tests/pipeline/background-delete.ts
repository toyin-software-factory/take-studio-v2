/** Deleting an uploaded background (AC-10). Called from background.ts. */
import { eq, inArray } from "drizzle-orm";
import { drainDeletions } from "../../src/db/data/deletion";
import * as schema from "../../src/db/schema";
import { db, r2 } from "./harness";
import { until, waitIdle } from "./wait";
import { type Env, S } from "./background-env";

export async function deleteScenarios(
  env: Env,
  keyed: string | undefined,
  warm: string | undefined,
): Promise<void> {
  const { c, check, list, takeOf } = env;
  // Deleting an uploaded background: its files go, a take that used it keeps its video (AC-10).
  try {
    if (keyed && warm) {
      await waitIdle(keyed);
      const change = await c.api("PUT", `/api/takes/${keyed}/background`, { backgroundId: warm });
      check(
        S,
        "AC-10: a take is put on the uploaded background again",
        change.status === 202,
        change,
      );
      await until(
        async () => takeOf(keyed!),
        (t) => t.backgroundJob?.status === "succeeded" || t.backgroundJob?.status === "failed",
        240,
      );
      await waitIdle(keyed);
      const [row] = await db.select().from(schema.background).where(eq(schema.background.id, warm));
      const keys = [row?.sourceKey, row?.imageKey, row?.thumbKey].filter((k): k is string => !!k);
      const removed = await c.api("DELETE", `/api/backgrounds/${warm}`);
      check(S, "AC-10: deleting it works (204)", removed.status === 204, removed.status);
      check(S, "AC-10: it leaves the library", !(await list()).mine.some((m) => m.id === warm), "");
      const queued = await db
        .select()
        .from(schema.storageDeletion)
        .where(inArray(schema.storageDeletion.objectKey, keys));
      check(
        S,
        "AC-10: all its files are queued for deletion",
        queued.length === keys.length && keys.length === 3,
        { keys: keys.length, queued: queued.length },
      );
      await drainDeletions(db, (k) => r2.deleteObject(k));
      const left = (await Promise.all(keys.map((k) => r2.headObject(k)))).filter(Boolean).length;
      check(S, "AC-10: the files are gone from R2 after the queue drains", left === 0, left);
      const t = await takeOf(keyed);
      const media = await c.api("GET", `/api/takes/${keyed}/media?kind=play`);
      check(
        S,
        "AC-10: the take keeps its video and shows the background's name",
        media.status === 200 && t.background?.name === "Pipeline warm",
        { media: media.status, bg: t.background },
      );
      const again = await c.api("DELETE", `/api/backgrounds/${warm}`);
      check(S, "AC-10: deleting it again is 404", again.status === 404, again.status);
      const next = await c.api("PUT", `/api/takes/${keyed}/background`, { backgroundId: warm });
      check(
        S,
        "AC-6: a deleted background can't be picked (404)",
        next.status === 404,
        next.status,
      );
    }
  } catch (error) {
    check(S, "Deletion ran", false, String(error));
  }
}
