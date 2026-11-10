/**
 * Registries for takes, processing jobs and their steps (spec 0002, "Feature design").
 * The Postgres enums (take.status, processing_job.status) and the text CHECKs are built
 * from these lists, so the database and the code agree. Add values only.
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

/** processing_job.kind. `reanalyse` arrives with slice 5 and is added to the CHECK then. */
export const JOB_KINDS = ["initial", "rerender"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** job_step.status. */
export const STEP_STATUSES = ["pending", "running", "succeeded", "failed", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * job_step.name, with the product slice that makes each step live.
 * A step whose slice is not live yet is not created at job start.
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
} as const satisfies Readonly<Record<JobKind, readonly StepName[]>>;

/** render.status. */
export const RENDER_STATUSES = ["pending", "succeeded", "failed"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];
