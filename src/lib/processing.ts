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
  /** A re render started by `startJob`: the take is `processing` again and the run is a full one. */
  rerender: 1,
  /**
   * Spec 0008: a background change started by `startBackgroundJob` on a Ready take. It reuses the
   * take's cuts, never moves the take, charges nothing and sends no email.
   */
  background: 3,
  /** Spec 0007: makes the transcript; never moves the take, charges nothing, sends no email. */
  transcribe: 2,
  reanalyse: 5,
} as const satisfies Readonly<Record<string, number>>;
export type JobKind = keyof typeof JOB_KIND_SLICES;
export const JOB_KINDS = Object.keys(JOB_KIND_SLICES) as readonly JobKind[];

/**
 * The kinds whose finish can send the "take ready or didn't finish" email (spec 0006). Only the
 * first run: a background change (spec 0008) is started from the take page, which shows the
 * result, so it sends nothing.
 */
export const EMAIL_JOB_KINDS = ["initial"] as const satisfies readonly JobKind[];

/** True for a job kind whose result is emailed; only `initial` is. */
export function jobKindSendsEmail(kind: string): boolean {
  return (EMAIL_JOB_KINDS as readonly string[]).includes(kind);
}

/** True for a kind that works on the take without ever changing its status (spec 0007). */
export function isTranscribeKind(kind: string): boolean {
  return kind === "transcribe";
}

/**
 * True for a background change (spec 0008): works beside a Ready take, never moves it, charges
 * nothing. The kind is the only rule: nothing looks at the take's status or the step list.
 */
export function isBackgroundKind(kind: string): boolean {
  return kind === "background";
}

/**
 * Whether a job is a background change (spec 0008): kind `background`, or, only while old Workers
 * may still be running (the deploy window of HRF-T08), a `rerender` on a take that is not
 * `processing` (the way background changes were recognised before the kind existed; a re render
 * started by `startJob` has the take in `processing`). Used where a running job is acted on:
 * `finishInTx` and `process-take`. LEGACY: a later cleanup task removes the `rerender` branch,
 * leaving `isBackgroundKind`; new changes create only `background` jobs.
 */
export function isBackgroundChange(kind: string, takeStatus: string): boolean {
  return isBackgroundKind(kind) || (kind === "rerender" && takeStatus !== "processing");
}

/** How a job relates to its take: owns it (`video`), changes only its look (`background`), or
 *  works beside it (`transcript`). */
export type JobFamily = "video" | "background" | "transcript";

/**
 * The family of a job kind. A `switch` with no default, so adding a kind to `JOB_KIND_SLICES`
 * fails the type check here until the new kind is placed.
 */
export function jobFamily(kind: JobKind): JobFamily {
  switch (kind) {
    case "initial":
    case "rerender":
    case "reanalyse":
      return "video";
    case "background":
      return "background";
    case "transcribe":
      return "transcript";
    default: {
      const unplaced: never = kind;
      return unplaced;
    }
  }
}

/**
 * Why a `transcript` step ended `skipped` (spec 0007). Stored in `job_step.failure_code`, and
 * only on a skipped step: a failed step carries a failure code instead (never both).
 */
export const SKIP_REASONS = [
  "not_english",
  "no_speech",
  "original_gone",
  /** Spec 0008: the take has no usable green screen, so its background is kept. */
  "no_green_screen",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export function isSkipReason(value: string): value is SkipReason {
  return (SKIP_REASONS as readonly string[]).includes(value);
}

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
 * Ordered step list per job kind (`position` follows this order). `background` is only
 * created when the job has a background to put in (`stepsFor` with `hasBackground`, spec 0008).
 */
export const STEPS_BY_KIND = {
  initial: ["trim", "background", "ai_edit", "render"],
  rerender: ["background", "render"],
  background: ["background", "render"],
  transcribe: ["transcript"],
  reanalyse: ["ai_edit", "render"],
} as const satisfies Readonly<Record<JobKind, readonly StepName[]>>;

/**
 * The latest product slice that is live. Steps and job kinds from later slices are allowed
 * in the database but not created yet. Bump it when a slice ships.
 */
export const LIVE_SLICE = 3;

type StepsForOptions = {
  readonly liveSlice?: number;
  /** Whether the job renders onto a background (`target_background_id` set, spec 0008). */
  readonly hasBackground?: boolean;
};

/**
 * The ordered steps to create for a new job of `kind`: skips steps whose slice is not live,
 * and the `background` step unless the job has a background to render onto.
 */
export function stepsFor(kind: JobKind, options: StepsForOptions = {}): readonly StepName[] {
  const { liveSlice = LIVE_SLICE, hasBackground = false } = options;
  return STEPS_BY_KIND[kind].filter(
    (name) => STEPS[name].slice <= liveSlice && !(name === "background" && !hasBackground),
  );
}

/** True for job statuses that never change again. */
export function isFinalJobStatus(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** background.status (spec 0008); built in studios are always `ready`. */
export const BACKGROUND_STATUSES = ["uploading", "processing", "ready", "failed"] as const;
export type BackgroundStatus = (typeof BACKGROUND_STATUSES)[number];

/** background_preview.status (spec 0008). */
export const PREVIEW_STATUSES = ["making", "ready", "failed"] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

/** background.name length bounds (spec 0008). */
export const BACKGROUND_NAME_MIN = 1;
export const BACKGROUND_NAME_MAX = 80;

/** render.status. */
export const RENDER_STATUSES = ["pending", "succeeded", "failed"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];
