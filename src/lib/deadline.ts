/**
 * Job deadlines (S2T-T07). Trigger.dev does not call `onFailure` for a run that exceeds
 * `maxDuration` (seen in a local run: TIMED_OUT, the job left active until the stale cleanup
 * marked it `stale_run`). So a task stops its own work a margin early, aborts what is in flight,
 * waits for that to wind down (ffmpeg killed, fetches aborted, temp files removed by the
 * work's own `finally`), then throws `DeadlineExceeded` from inside `run()`. The normal failure
 * path then finishes the job as `timeout`. The stale cleanup stays the backstop for a worker
 * that crashes.
 */

/**
 * Seconds before `maxDuration` at which an attempt stops itself. The failure hooks run inside
 * the same budget: the global Sentry hook (flush, 2 s), then the task's own, which opens a job
 * database client (first connect: up to 3 tries of 10 s plus 1 s and 2 s waits, so 33 s),
 * writes the job and closes the client (5 s). About 45 s in the worst case, so 90 s leaves room.
 */
export const DEADLINE_MARGIN_SECONDS = 90;

/** How long aborted work gets to wind down before the error is thrown anyway. */
const WIND_DOWN_MS = 10_000;

/** The attempt ran out of its own time. The message holds nothing about the work. */
export class DeadlineExceeded extends Error {
  override name = "DeadlineExceeded";
  constructor() {
    super("The job ran out of time and was stopped");
  }
}

/** True for a `DeadlineExceeded` (also across module copies, which keep the name). */
export function isDeadlineExceeded(error: unknown): boolean {
  return (error as { name?: string } | null | undefined)?.name === "DeadlineExceeded";
}

/** Milliseconds a task with this `maxDuration` may work before it stops itself. */
export function deadlineMs(maxDurationSeconds: number): number {
  return Math.max(1, maxDurationSeconds - DEADLINE_MARGIN_SECONDS) * 1000;
}

/**
 * Runs `work` with a signal that aborts after `ms`. `work` must honour the signal (kill its
 * child process, abort its fetches) and clean up in its own `finally`. After the abort this
 * waits for `work` to settle (at most `windDownMs`), then throws `DeadlineExceeded`, whatever
 * `work` itself threw while stopping and even if it resolved during the wind down (a late
 * success is rejected; the tasks also check the signal before they commit a success and guard
 * their writes by the job still being active). Work that finishes in time returns or throws
 * as usual.
 */
export async function runWithDeadline<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
  options: { readonly windDownMs?: number } = {},
): Promise<T> {
  const windDownMs = options.windDownMs ?? WIND_DOWN_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DeadlineExceeded()), ms);
  let windDownTimer: ReturnType<typeof setTimeout> | undefined;
  const running = work(controller.signal);
  const stuck = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        windDownTimer = setTimeout(() => reject(new DeadlineExceeded()), windDownMs);
      },
      { once: true },
    );
  });
  // Whichever loses the race must not become an unhandled rejection.
  running.catch(() => undefined);
  stuck.catch(() => undefined);
  try {
    const result = await Promise.race([running, stuck]);
    if (controller.signal.aborted) throw new DeadlineExceeded();
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new DeadlineExceeded();
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(windDownTimer);
  }
}
