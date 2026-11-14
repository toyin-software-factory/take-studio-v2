import { logger, task } from "@trigger.dev/sdk";
import { withJobDb } from "@/db/client/job";
import { enableUsageLimit, reconcileUsage } from "@/db/data/usage-reconcile";
import { parseJobEnv } from "@/lib/env";
import { runUsageReconcile } from "./run-usage-reconcile";

/**
 * Manual, token gated (`AI_EVAL_TOKEN`): the reconcile of spec 0014 AC-11, then
 * `usage_limit_enabled` = true. See `run-usage-reconcile.ts`.
 */
export const usageReconcileTask = task({
  id: "usage-reconcile",
  machine: "micro",
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: (payload: unknown) =>
    runUsageReconcile(
      payload,
      process.env.AI_EVAL_TOKEN,
      (fn) =>
        withJobDb(parseJobEnv().DATABASE_URL, (db) =>
          fn({
            reconcile: () => reconcileUsage(db),
            enableLimit: () => enableUsageLimit(db),
          }),
        ),
      (message, counts) => logger.info(message, counts),
    ),
});
