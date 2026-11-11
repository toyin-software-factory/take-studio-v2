import { logger, task } from "@trigger.dev/sdk";

/**
 * STUB until spec 0004 build plan step 3 (S1C-T03): the real process-take (trim, render,
 * upload, finish) replaces this. It exists so the probe can already dispatch it. A job left
 * queued by this stub is failed with `stale_run` (refunded) by the cleanup schedule.
 */
export const processTakeTask = task({
  id: "process-take",
  machine: "small-1x",
  maxDuration: 60,
  run: async (payload: { readonly jobId: string }) => {
    logger.info("process-take stub: not implemented yet", { jobId: payload.jobId });
    return { jobId: payload.jobId, stub: true };
  },
});
