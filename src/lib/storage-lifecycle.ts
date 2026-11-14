import { VIDEO_RETENTION_DAYS } from "./take-rules";

/**
 * R2 lifecycle rules (spec 0013, AC-9): a backstop to the cleanup sweep and the deletion queue.
 * The app promises 30 days (`VIDEO_RETENTION_DAYS`); the sweep owns the normal case and these
 * rules only catch a file a stuck job left behind, so they run later. Pure: the script
 * `scripts/apply-r2-lifecycle.ts` sends the result to Cloudflare.
 */

/** Days after an object was written that the bucket deletes it. One constant: change it here. */
export const BACKSTOP_DAYS = 35;

/** Days after which an upload that was never completed is aborted. */
export const ABORT_INCOMPLETE_DAYS = 2;

/**
 * The only prefixes a rule may cover. `backgrounds/` (the built in studios and uploaded
 * backgrounds, which are not part of the 30 day promise) is deliberately absent.
 */
export const LIFECYCLE_PREFIXES = ["originals/", "renders/", "previews/"] as const;

const SECONDS_PER_DAY = 86_400;

export type LifecycleRule = {
  readonly id: string;
  readonly enabled: true;
  readonly conditions: { readonly prefix: string };
  readonly deleteObjectsTransition: {
    readonly condition: { readonly type: "Age"; readonly maxAge: number };
  };
  readonly abortMultipartUploadsTransition: {
    readonly condition: { readonly type: "Age"; readonly maxAge: number };
  };
};

/** Cloudflare's lifecycle body: one rule per prefix, ages in seconds. */
export function lifecycleRules(
  backstopDays: number = BACKSTOP_DAYS,
  abortDays: number = ABORT_INCOMPLETE_DAYS,
): { readonly rules: readonly LifecycleRule[] } {
  return {
    rules: LIFECYCLE_PREFIXES.map((prefix) => ({
      id: `backstop-${prefix.replace("/", "")}`,
      enabled: true,
      conditions: { prefix },
      deleteObjectsTransition: {
        condition: { type: "Age", maxAge: backstopDays * SECONDS_PER_DAY },
      },
      abortMultipartUploadsTransition: {
        condition: { type: "Age", maxAge: abortDays * SECONDS_PER_DAY },
      },
    })),
  };
}

/** Days the promise is kept in the app, for the guard test and the script's log line. */
export const PROMISE_DAYS = VIDEO_RETENTION_DAYS;
