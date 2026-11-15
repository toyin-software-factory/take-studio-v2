export type StepView = {
  readonly name: string;
  readonly status: string;
  readonly progress: number | null;
};

/**
 * Weights of the steps in the overall bar (spec 0012): trim 10, transcript 5, AI edit 5,
 * background 5 (only when the job has one), render 75. The bar divides by the steps the job has.
 */
const STEP_WEIGHTS: Readonly<Record<string, number>> = {
  trim: 10,
  transcript: 5,
  ai_edit: 5,
  background: 5,
  render: 75,
};

/** A step's own percent: done or skipped is 100, pending 0, running its reported progress. */
export function stepPercent(step: StepView): number {
  // A failed step (only the non fatal transcript step can end this way on a job that goes on)
  // is over, like a skipped one.
  if (step.status === "succeeded" || step.status === "skipped" || step.status === "failed") {
    return 100;
  }
  if (step.status === "running") return Math.min(100, Math.max(0, step.progress ?? 0));
  return 0;
}

/** Overall percent across the job's steps with their weights (unknown steps weigh 0). */
export function overallPercent(steps: readonly StepView[]): number {
  const total = steps.reduce((sum, s) => sum + (STEP_WEIGHTS[s.name] ?? 0), 0);
  if (total === 0) return 0;
  const done = steps.reduce((sum, s) => sum + (STEP_WEIGHTS[s.name] ?? 0) * stepPercent(s), 0);
  return Math.floor(done / total);
}

const STEP_LABELS: Readonly<Record<string, string>> = {
  trim: "Find pauses",
  transcript: "Transcript",
  background: "Background",
  ai_edit: "AI edit",
  render: "Make the video",
};

export function stepLabel(name: string): string {
  return STEP_LABELS[name] ?? name;
}

const STEP_STATUS_TEXT: Readonly<Record<string, string>> = {
  pending: "Waiting",
  running: "In progress",
  succeeded: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export function stepStatusText(
  step: StepView,
  options: { readonly jobFailed?: boolean } = {},
): string {
  if (step.status === "running" && step.progress !== null) return `${stepPercent(step)}%`;
  // Spec 0012: a failed step of a job that did not fail is a quiet "Skipped".
  if (step.status === "failed" && !options.jobFailed) return STEP_STATUS_TEXT.skipped ?? "Skipped";
  return STEP_STATUS_TEXT[step.status] ?? step.status;
}

/** Tab title (AC-8): "Processing… · My take · Take Studio", "Ready · My take · Take Studio". */
export function tabTitle(status: string, title: string): string {
  const prefix: Readonly<Record<string, string>> = {
    uploading: "Uploading…",
    uploaded: "Processing…",
    processing: "Processing…",
    ready: "Ready",
    failed: "Failed",
    expired: "Expired",
  };
  const lead = prefix[status];
  return lead ? `${lead} · ${title} · Take Studio` : `${title} · Take Studio`;
}
