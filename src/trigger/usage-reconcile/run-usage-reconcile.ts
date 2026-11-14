import { z } from "zod";
import type { ReconcileSummary } from "@/db/data/usage-reconcile";
import { sentryCheckAllowed } from "@/lib/sentry-check";

/**
 * The switch on of the monthly usage limit (spec 0014, AC-11), as a manual task because agents
 * have no production database. In order: (1) the token must equal `AI_EVAL_TOKEN`, else nothing
 * happens (no database is opened); (2) the reconcile runs; (3) only when it finished with no
 * failed job is `usage_limit_enabled` set to true. A reconcile that throws or leaves a job owed
 * leaves the flag as it was. Safe to run again: a second run adds and subtracts nothing and
 * sets the flag to the value it already has. Numbers only in the result and the logs.
 */
export const payloadSchema = z.object({ token: z.string().min(1) });

export type UsageSwitchOn =
  | { readonly outcome: "skipped" }
  | { readonly outcome: "reconcile_failed"; readonly summary: ReconcileSummary | null }
  | { readonly outcome: "enabled"; readonly summary: ReconcileSummary };

/** The database side, passed in so tests can fake it and record the order of the steps. */
export type UsageSwitchDb = {
  readonly reconcile: () => Promise<ReconcileSummary>;
  readonly enableLimit: () => Promise<void>;
};

export async function runUsageReconcile(
  payload: unknown,
  expectedToken: string | undefined,
  open: <T>(fn: (db: UsageSwitchDb) => Promise<T>) => Promise<T>,
  log: (message: string, counts: Readonly<Record<string, number | boolean>>) => void,
): Promise<UsageSwitchOn> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || !(await sentryCheckAllowed(parsed.data.token, expectedToken))) {
    return { outcome: "skipped" };
  }
  return open(async (db) => {
    let summary: ReconcileSummary;
    try {
      summary = await db.reconcile();
    } catch {
      log("usage-reconcile: reconcile failed", { enabled: false });
      return { outcome: "reconcile_failed", summary: null } as const;
    }
    log("usage-reconcile: reconciled", {
      jobs: summary.jobs,
      secondsAdded: summary.added,
      secondsSubtracted: summary.subtracted,
      failed: summary.failed,
    });
    if (summary.failed > 0) {
      log("usage-reconcile: left off, run again", { enabled: false });
      return { outcome: "reconcile_failed", summary } as const;
    }
    await db.enableLimit();
    log("usage-reconcile: limit enabled", { enabled: true });
    return { outcome: "enabled", summary } as const;
  });
}
