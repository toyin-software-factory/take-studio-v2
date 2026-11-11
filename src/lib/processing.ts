/**
 * Registries for takes, processing jobs and their steps (spec 0002, "Feature design").
 * The Postgres enums (take.status, processing_job.status) and the text CHECKs are built
 * from these lists, so the database and the code agree. Every value the spec defines is
 * allowed in the database now; slice tags say when code starts using it. Add values only.
 */

/** take.status (Postgres enum). */
export const TAKE_STATUSES = [
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "expired",
] as const;
export type TakeStatus = (typeof TAKE_STATUSES)[number];

/** processing_job.status (Postgres enum). `succeeded`, `failed` and `cancelled` are final. */
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Statuses that count as an active job (at most one per take, AC-4). */
export const ACTIVE_JOB_STATUSES = ["queued", "running"] as const satisfies readonly JobStatus[];

/** take.title length, in characters. */
export const TAKE_TITLE_MIN = 1;
export const TAKE_TITLE_MAX = 200;

/** Upload containers accepted (AC-5). */
export const CONTAINERS = ["mp4", "mov"] as const;
export type Container = (typeof CONTAINERS)[number];

/**
 * processing_job.kind, with the product slice that makes each kind live.
 * The DB CHECK allows every kind now; `reanalyse` is only started from slice 5.
 */
export const JOB_KIND_SLICES = {
  initial: 1,
  rerender: 1,
  reanalyse: 5,
} as const satisfies Readonly<Record<string, number>>;
export type JobKind = keyof typeof JOB_KIND_SLICES;
export const JOB_KINDS = Object.keys(JOB_KIND_SLICES) as readonly JobKind[];

/** job_step.status. */
export const STEP_STATUSES = ["pending", "running", "succeeded", "failed", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * job_step.name, with the product slice that makes each step live.
 * The DB CHECK allows every step now; a step whose slice is not live yet is not created at job start.
 */
export const STEPS = {
  trim: { slice: 1 },
  transcript: { slice: 2 },
  background: { slice: 3 },
  ai_edit: { slice: 5 },
  render: { slice: 1 },
} as const satisfies Readonly<Record<string, { readonly slice: number }>>;
export type StepName = keyof typeof STEPS;
export const STEP_NAMES = Object.keys(STEPS) as readonly StepName[];

/**
 * Ordered step list per job kind (`position` follows this order).
 * For `rerender`, `background` runs only if the take's background changed since the
 * latest render; jobs.start applies that rule.
 */
export const STEPS_BY_KIND = {
  initial: ["trim", "transcript", "background", "ai_edit", "render"],
  rerender: ["background", "render"],
  reanalyse: ["ai_edit", "render"],
} as const satisfies Readonly<Record<JobKind, readonly StepName[]>>;

/**
 * The latest product slice that is live. Steps and job kinds from later slices are allowed
 * in the database but not created yet. Bump it when a slice ships.
 */
export const LIVE_SLICE = 1;

type StepsForOptions = {
  readonly liveSlice?: number;
  /** For `rerender`: whether the take's background changed since the latest render. */
  readonly backgroundChanged?: boolean;
};

/**
 * The ordered steps to create for a new job of `kind`: skips steps whose slice is not live,
 * and for a re render skips `background` unless the background changed.
 */
export function stepsFor(kind: JobKind, options: StepsForOptions = {}): readonly StepName[] {
  const { liveSlice = LIVE_SLICE, backgroundChanged = false } = options;
  return STEPS_BY_KIND[kind].filter(
    (name) =>
      STEPS[name].slice <= liveSlice &&
      !(kind === "rerender" && name === "background" && !backgroundChanged),
  );
}

/** True for job statuses that never change again. */
export function isFinalJobStatus(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** render.status. */
export const RENDER_STATUSES = ["pending", "succeeded", "failed"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];
