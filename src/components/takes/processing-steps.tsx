"use client";

import {
  CircleCheck,
  CircleAlert,
  CircleDashed,
  CircleMinus,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { StagePanel } from "@/components/stage";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import {
  type StepView,
  overallPercent,
  stepLabel,
  stepPercent,
  stepStatusText,
} from "@/lib/take-display";

const STEP_ICONS: Readonly<Record<string, LucideIcon>> = {
  pending: CircleDashed,
  running: LoaderCircle,
  succeeded: CircleCheck,
  failed: CircleAlert,
  skipped: CircleMinus,
};

const STATUS_WORDS: Readonly<Record<string, string>> = {
  pending: "waiting",
  running: "in progress",
  succeeded: "done",
  failed: "failed",
  skipped: "skipped",
};

const HEADLINES: Readonly<Record<string, string>> = {
  uploading: "Checking your video…",
  uploaded: "Starting…",
  processing: "Trimming your take…",
};

/**
 * Processing progress on the stage (AC-8; design.md Processing progress): the overall bar on
 * top (trim 10 %, render 90 %), then one row per step with icon, label, status text and its own
 * bar. Before the job has steps, an indeterminate bar. Step changes (not percents) are announced politely.
 */
export function ProcessingSteps({
  status,
  steps,
}: {
  readonly status: string;
  readonly steps: readonly StepView[];
}) {
  const overall = steps.length > 0 ? overallPercent(steps) : undefined;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-6 sm:py-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-h3 font-semibold">{HEADLINES[status] ?? "Working on it…"}</h2>
        {overall !== undefined ? <span className="mono text-small">{overall}%</span> : null}
      </div>
      <Progress aria-label="Overall progress" value={overall} />
      <p className="text-small text-stage-text-muted">
        You can leave this page. Processing carries on and your take will be here when you come
        back.
      </p>
      {/* Announce step changes, not every percent. */}
      <p aria-live="polite" className="sr-only">
        {steps
          .map((step) => `${stepLabel(step.name)}: ${STATUS_WORDS[step.status] ?? step.status}.`)
          .join(" ")}
      </p>
      {steps.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {steps.map((step) => (
            <li key={step.name}>
              <StagePanel className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Icon
                    icon={STEP_ICONS[step.status] ?? CircleDashed}
                    className={
                      step.status === "running"
                        ? "animate-spin motion-reduce:animate-none"
                        : undefined
                    }
                  />
                  <span className="flex-1 font-medium">{stepLabel(step.name)}</span>
                  <span className="mono text-small text-stage-text-muted">
                    {stepStatusText(step)}
                  </span>
                </div>
                <Progress
                  aria-label={`${stepLabel(step.name)} progress`}
                  value={stepPercent(step)}
                />
              </StagePanel>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
