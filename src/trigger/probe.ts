import { logger, task } from "@trigger.dev/sdk";

/**
 * STUB until spec 0004 build plan step 2: the real probe (ranged ffprobe, rotation, audio,
 * HDR, thumbnail, markUploaded, then jobs.start and process-take) replaces this. It exists so
 * upload completion can already dispatch `probe` with its idempotency key. IDs only.
 */
export const probeTask = task({
  id: "probe",
  machine: "small-1x",
  maxDuration: 60,
  run: async (payload: { readonly takeId: string }) => {
    logger.info("probe stub: not implemented yet", { takeId: payload.takeId });
    return { takeId: payload.takeId, stub: true };
  },
});
