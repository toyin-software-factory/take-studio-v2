import type { Cut } from "@/db/data/cuts";
import type { JobStep, ProcessingJob, Render, Take } from "@/db/types";
import { isExpired, isRetryable } from "@/lib/take-media";
import type { TakeListRow } from ".";

/**
 * The JSON shapes the take routes return (spec 0004 API surface). Storage keys and anything
 * else internal stay on the server: clients get IDs, statuses and facts, and media only
 * through the signed links of /api/takes/{id}/media.
 */

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function takeView(take: Take, now: Date) {
  return {
    id: take.id,
    title: take.title,
    status: take.status,
    container: take.container,
    // Spec 0021: where the video came from, and the creator's own script (null when none).
    source: take.source,
    script: take.script,
    durationMs: take.durationMs,
    videoExpiresAt: iso(take.videoExpiresAt),
    createdAt: iso(take.createdAt),
    failureCode: take.failureCode,
    retryable: isRetryable(take, now),
    expired: isExpired(take, now),
  };
}

export function cardView(row: TakeListRow, now: Date) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    // The trimmed length once there is a render, else the uploaded length.
    durationMs: row.latestRenderDurationMs ?? row.durationMs,
    videoExpiresAt: iso(row.videoExpiresAt),
    createdAt: iso(row.createdAt),
    failureCode: row.failureCode,
    retryable: isRetryable(row, now),
    expired: isExpired(row, now),
  };
}

/** One row of the sidebar's recent takes: just what the shell shows. */
export function recentView(row: TakeListRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    // The trimmed length once there is a render, else the uploaded length.
    durationMs: row.latestRenderDurationMs ?? row.durationMs,
  };
}

export type RecentTake = ReturnType<typeof recentView>;

export function jobView(job: ProcessingJob & { readonly steps: readonly JobStep[] }) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    failureCode: job.failureCode,
    steps: job.steps.map((step) => ({
      name: step.name,
      status: step.status,
      progress: step.progress,
    })),
  };
}

export function renderView(render: Render) {
  return {
    id: render.id,
    status: render.status,
    durationMs: render.durationMs,
    // Spec 0011: the snapshot of cut ranges this render was made with (the page maps time with it).
    removedRanges: render.removedRanges,
  };
}

/**
 * Spec 0026 AC-8, AC-9: what the stored finished video has. `applied` is true only for a
 * succeeded latest render that carries the credit (as is takes have no render, so false).
 * `canChange` is false until the paid switch exists (every account is free, spec 0024 is not
 * built); `choice` is the paid creator's saved answer, null when none.
 */
export function creditView(
  take: Take,
  latestRender: Render | null,
): {
  readonly applied: boolean;
  readonly canChange: boolean;
  readonly choice: "on" | "off" | null;
} {
  return {
    applied: latestRender?.status === "succeeded" && latestRender.creditApplied,
    canChange: false,
    choice: take.creditChoice === "on" || take.creditChoice === "off" ? take.creditChoice : null,
  };
}

/** A cut as the take page's timeline reads it (spec 0011); `applied` is the current video's state. */
export function cutView(cut: Cut) {
  return {
    id: cut.id,
    startMs: cut.startMs,
    endMs: cut.endMs,
    kind: cut.kind,
    applied: cut.applied,
    // Spec 0012: who proposed it and why. The reason can quote the take: never log it.
    proposedBy: cut.proposedBy,
    reason: cut.reason,
  };
}
