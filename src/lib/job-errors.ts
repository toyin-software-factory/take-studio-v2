/**
 * The names of the job errors that turn into a failure code (HRF-T10).
 *
 * A failure hook may get the error without its class (the run's error comes back across a process
 * boundary as `{ name, message }`), and a bundle can hold two copies of a class. So the mappers
 * (`failureCodeFor` in `process-take`, `transcribeFailureCode` in `transcribe-take`) match on the
 * error's `name` as well as `instanceof`. Each name lives here once: the class sets it and the
 * mapper compares against it, so renaming a class cannot leave the mapper looking for the old
 * text and quietly falling back to `internal_error`. `failure-code-table.test.ts` throws every
 * error through every mapper and checks the code.
 */
export const JOB_ERROR_NAMES = {
  deadlineExceeded: "DeadlineExceeded",
  backgroundMissing: "BackgroundMissingError",
  mediaTool: "MediaToolError",
  deepgramError: "DeepgramError",
  deepgramTimeout: "DeepgramTimeout",
  deepgramRejected: "DeepgramRejected",
} as const;

export type JobErrorName = (typeof JOB_ERROR_NAMES)[keyof typeof JOB_ERROR_NAMES];

/** True when the error (a class instance or a plain `{ name }` copy of one) has this name. */
export function hasJobErrorName(error: unknown, name: JobErrorName): boolean {
  return (error as { name?: unknown } | null | undefined)?.name === name;
}
