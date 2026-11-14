import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * One row per `ai-eval` run (B2-T72, spec 0017): scores, case ids and cut kinds with times.
 * The cases are invented test fixtures, so there is no personal data here and no foreign key.
 * Only the newest 50 rows are kept.
 */
export const aiEvalRun = pgTable(
  "ai_eval_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ranAt: timestamp("ran_at", { withTimezone: true }).defaultNow().notNull(),
    model: text("model").notNull(),
    cases: integer("cases").notNull(),
    overallPrecision: doublePrecision("overall_precision").notNull(),
    overallRecall: doublePrecision("overall_recall").notNull(),
    mainPrecision: doublePrecision("main_precision").notNull(),
    mainRecall: doublePrecision("main_recall").notNull(),
    holdoutPrecision: doublePrecision("holdout_precision").notNull(),
    holdoutRecall: doublePrecision("holdout_recall").notNull(),
    wrongKeeps: integer("wrong_keeps").notNull(),
    /** `StoredCase[]` (`src/lib/ai-eval-record.ts`). */
    summary: jsonb("summary").notNull(),
  },
  (t) => [index("ai_eval_run_ran_at_idx").on(t.ranAt)],
);
