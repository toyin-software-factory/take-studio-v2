import { logger, task } from "@trigger.dev/sdk";
import { realEvalIo, runAiEval } from "./run-eval";

/**
 * Cut quality check with the real model (spec 0017, AC-10). Manual only: Toyin starts it from the
 * Trigger.dev dashboard with the payload `{ "token": "<AI_EVAL_TOKEN>" }`. It runs only when the
 * payload token equals `AI_EVAL_TOKEN` of the Trigger.dev environment (constant time compare);
 * in every other case it makes no model call. It logs numbers only and never writes a file.
 */
export const aiEvalTask = task({
  id: "ai-eval",
  machine: "micro",
  // 14 cases, each bounded by the 120 s edit deadline, run one after the other.
  maxDuration: 1800,
  // One attempt: a retry would pay for the whole set again.
  retry: { maxAttempts: 1 },
  run: (payload: unknown) =>
    runAiEval(
      payload,
      {
        AI_EVAL_TOKEN: process.env.AI_EVAL_TOKEN,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
      realEvalIo((message, fields) => logger.info(message, fields)),
    ),
});
