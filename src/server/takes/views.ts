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
    durationMs: take.durationMs,
    videoExpiresAt: iso(take.videoExpiresAt),
    createdAt: iso(take.createdAt),
    failureCode: take.failureCode,
    retryable: isRetryable(take),
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
    retryable: isRetryable(row),
    expired: isExpired(row, now),
  };
}

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
  return { id: render.id, status: render.status, durationMs: render.durationMs };
}
