import { desc, sql } from "drizzle-orm";
import { EVAL_RUNS_KEPT, type EvalRunRow } from "@/lib/ai-eval-record";
import { aiEvalRun } from "../schema";
import type { Executor } from "../types";

/** Saves one run and deletes every run but the newest `keep` (50). Numbers and case ids only. */
export async function saveEvalRun(
  db: Executor,
  row: EvalRunRow,
  keep: number = EVAL_RUNS_KEPT,
): Promise<void> {
  await db.insert(aiEvalRun).values({ ...row, summary: row.summary });
  await db.execute(
    sql`delete from ai_eval_run where id in (
      select id from ai_eval_run order by ran_at desc, id desc offset ${keep}
    )`,
  );
}

/** The newest runs first. */
export function listEvalRuns(db: Executor, limit: number) {
  return db
    .select()
    .from(aiEvalRun)
    .orderBy(desc(aiEvalRun.ranAt), desc(aiEvalRun.id))
    .limit(limit);
}
