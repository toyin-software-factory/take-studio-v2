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
  return async (jobId: string, creatorId?: string): Promise<{ readonly id: string }> => {
    const idempotencyKey = await idempotencyKeys.create(`job-${jobId}`, { scope: "global" });
    const handle = await tasks.trigger(
      taskId,
      { jobId },
      jobTriggerOptions(idempotencyKey, creatorId),
    );
    return { id: handle.id };
  };
}

/**
 * The trigger options of a job run. With the creator, the run gets the concurrency key
 * `creator-{id}`: the task's queue limit then applies per creator, so one creator's many jobs
 * wait behind each other and never take every slot. Pure, so a test can show two creators get
 * different keys.
 */
export function jobTriggerOptions<K>(
  idempotencyKey: K,
  creatorId: string | undefined,
): { readonly idempotencyKey: K; readonly concurrencyKey?: string } {
  return creatorId === undefined
    ? { idempotencyKey }
    : { idempotencyKey, concurrencyKey: `creator-${creatorId}` };
}

/** Run statuses that mean "still on its way": waiting in a queue, or already starting. */
const WAITING_RUN_STATUSES: ReadonlySet<string> = new Set([
  "PENDING_VERSION",
  "QUEUED",
  "DELAYED",
  "DEQUEUED",
  "EXECUTING",
]);

/** Whether a Trigger.dev run status is one of a run that has not started or is just starting. */
export function isWaitingRunStatus(status: string): boolean {
  return WAITING_RUN_STATUSES.has(status);
}

/**
 * Whether a run is still waiting its turn, for the cleanup: a queued job behind its creator's
 * concurrency limit is not stale. If Trigger.dev cannot be asked the answer is "yes" (leave it
 * for the next sweep; the 6 hour backstop still ends it), never a guess that fails a live job.
 */
export async function isRunWaiting(runId: string): Promise<boolean> {
  try {
    const run = await runs.retrieve(runId);
    return isWaitingRunStatus(String(run.status));
  } catch {
    return true;
  }
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
  // `redispatch` lets the probe's onFailure tell the newest dispatch from an older one.
  await tasks.trigger("probe", { takeId, redispatch }, { idempotencyKey });
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

/**
 * Triggers `transcribe-take` for a transcribe job with the global idempotency key
 * `transcribe-{jobId}` (spec 0007). Pass it to `dispatchJob`; payload: the job ID only.
 */
export function triggerForTranscribe() {
  return async (jobId: string): Promise<{ readonly id: string }> => {
    const idempotencyKey = await idempotencyKeys.create(`transcribe-${jobId}`, {
      scope: "global",
    });
    const handle = await tasks.trigger("transcribe-take", { jobId }, { idempotencyKey });
    return { id: handle.id };
  };
}

/**
 * Triggers `ingest-background` for an uploaded background with the global idempotency key
 * `ingest-{backgroundId}` (spec 0008), so repeated completions never ingest twice. Payload: the
 * background ID only.
 */
export async function triggerIngest(backgroundId: string): Promise<{ readonly id: string }> {
  const idempotencyKey = await idempotencyKeys.create(`ingest-${backgroundId}`, {
    scope: "global",
  });
  const handle = await tasks.trigger("ingest-background", { backgroundId }, { idempotencyKey });
  return { id: handle.id };
}

/**
 * Triggers `preview-background` for a preview (spec 0008). One preview at a time per take: the
 * concurrency key `preview-{takeId}` gives each take its own queue of limit 1. The idempotency
 * key holds the row's last change, so a repeated request for the same attempt never starts a
 * second run, while a reset (a failed or stale preview asked for again) starts a new one.
 */
export async function triggerPreview(preview: {
  readonly id: string;
  readonly takeId: string;
  readonly updatedAt: Date;
}): Promise<{ readonly id: string }> {
  const idempotencyKey = await idempotencyKeys.create(
    `preview-${preview.id}-${preview.updatedAt.getTime()}`,
    { scope: "global" },
  );
  const handle = await tasks.trigger(
    "preview-background",
    { previewId: preview.id },
    { idempotencyKey, concurrencyKey: `preview-${preview.takeId}` },
  );
  return { id: handle.id };
}
