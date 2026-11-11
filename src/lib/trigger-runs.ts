import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";

/**
 * Small Trigger.dev helpers shared by the web app and jobs. They read TRIGGER_SECRET_KEY from
 * the environment, like the rest of the SDK. Payloads carry IDs only.
 */

/**
 * Triggers `taskId` for a job with a global idempotency key derived from the job ID, so
 * repeating the call never starts a second run. Pass it to `dispatchJob`.
 */
export function triggerForJob(taskId: string) {
  return async (jobId: string): Promise<{ readonly id: string }> => {
    const idempotencyKey = await idempotencyKeys.create(`job-${jobId}`, { scope: "global" });
    const handle = await tasks.trigger(taskId, { jobId }, { idempotencyKey });
    return { id: handle.id };
  };
}

/**
 * The global idempotency key of a probe dispatch: `probe-{takeId}` for the first (upload
 * completion), `probe-{takeId}-{n}` for the cleanup's n-th re-dispatch. Keys are global, so a
 * re-dispatch needs its own key or Trigger.dev would hand back the first run.
 */
export function probeKey(takeId: string, redispatch = 0): string {
  return redispatch === 0 ? `probe-${takeId}` : `probe-${takeId}-${redispatch}`;
}

/**
 * Triggers the `probe` task for an uploaded take with the global idempotency key from
 * `probeKey`, so repeated upload completions never probe twice. Payload: IDs only.
 */
export async function triggerProbe(takeId: string, redispatch = 0): Promise<void> {
  const idempotencyKey = await idempotencyKeys.create(probeKey(takeId, redispatch), {
    scope: "global",
  });
  await tasks.trigger("probe", { takeId }, { idempotencyKey });
}

/** Starts a queue drain now; failures are fine (the cleanup schedule drains every 15 minutes). */
export async function requestStorageDrain(): Promise<void> {
  try {
    await tasks.trigger("storage-deletion", {});
  } catch {
    // Best effort by design.
  }
}

/**
 * Cancels runs, best effort: a run that already finished can't be cancelled, and a failure
 * here must not undo a deletion that already committed. Returns how many were cancelled.
 */
export async function cancelRuns(runIds: readonly string[]): Promise<number> {
  const results = await Promise.allSettled(runIds.map((id) => runs.cancel(id)));
  return results.filter((result) => result.status === "fulfilled").length;
}
