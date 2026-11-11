import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { completeLatest, create } from "@/db/data/renders";
import { render, take } from "@/db/schema";
import type { Executor, Render } from "@/db/types";
import { type Result, err, ok } from "@/lib/result";

/**
 * Render functions (spec 0002, AC-2, AC-10). `create` and `completeLatest` are system
 * functions (re exported for one `renders` surface); the take's latest render is set by
 * `jobs.finish`. Creator reads go through `take.creator_id`.
 */
export { completeLatest, create };

/** `renders.getForCreator`: one of the creator's renders; another creator's is `not_found`. */
export async function getForCreator(
  db: Executor,
  creatorId: string,
  renderId: string,
): Promise<Result<Render, "not_found">> {
  if (!z.uuid().safeParse(renderId).success) return err("not_found");
  const [row] = await db
    .select({ render })
    .from(render)
    .innerJoin(take, eq(take.id, render.takeId))
    .where(and(eq(render.id, renderId), eq(take.creatorId, creatorId)));
  return row ? ok(row.render) : err("not_found");
}
