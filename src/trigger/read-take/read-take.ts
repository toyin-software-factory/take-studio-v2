import { logger, task } from "@trigger.dev/sdk";
import { withJobDb } from "@/db/client/job";
import { parseJobEnv } from "@/lib/env";
import { runReadTake } from "./run-read-take";

/** TEMPORARY (B2-T36): see `run-read-take.ts`. Manual only, token gated, one take. */
export const readTakeTask = task({
  id: "read-take",
  machine: "micro",
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  run: (payload: unknown) =>
    runReadTake(
      payload,
      process.env.AI_EVAL_TOKEN,
      async () => {
        const env = parseJobEnv();
        return { run: (fn) => withJobDb(env.DATABASE_URL, fn) };
      },
      (message, counts) => logger.info(message, counts),
    ),
});
