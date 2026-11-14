import { logger } from "@trigger.dev/sdk";
import { and, count, eq } from "drizzle-orm";
import type { Executor } from "@/db/types";
import { insertAnalyticsEvent } from "@/db/data/analytics";
import { cut, jobStep } from "@/db/schema";
import { isBackgroundKind, isTranscribeKind } from "@/lib/processing";
import { type AnalyticsEventInput, aiEditOutcome, parseEventProps } from "@/lib/analytics-events";

/**
 * Job side recorder (spec 0016 AC-6). Jobs cannot import `src/server`, so this validates with the
 * shared schemas and writes through `src/db/data/analytics.ts`. Best effort and idempotent: it
 * never throws, so a failed insert cannot change a job's result, and it logs IDs only.
 */
export async function recordJobEvent(db: Executor, event: AnalyticsEventInput): Promise<boolean> {
  const props = parseEventProps(event.name, event.props);
  if (!props) {
    logger.error("analytics event refused", { name: event.name, takeId: event.takeId ?? null });
    return false;
  }
  try {
    return await insertAnalyticsEvent(db, {
      name: event.name,
      creatorId: event.creatorId,
      takeId: event.takeId ?? null,
      props,
    });
  } catch {
    logger.error("analytics event failed", { name: event.name, takeId: event.takeId ?? null });
    return false;
  }
}

/** Records a failed take with its failure code (AC-4). */
export function recordTakeFailed(
  db: Executor,
  take: { readonly id: string; readonly creatorId: string },
  code: string,
): Promise<boolean> {
  return recordJobEvent(db, {
    name: "take_failed",
    creatorId: take.creatorId,
    takeId: take.id,
    props: { code },
  });
}

/**
 * After a video job succeeds: `take_ready` (once per take, so a later re render adds nothing) and,
 * when the AI edit finished `done`, `ai_edit_used`. `aiEdit` comes from the job's persisted
 * `ai_edit` step row and `cuts` counts the applied AI cuts now stored; both are read here, after
 * the finish committed. Never throws.
 */
export async function recordTakeReady(
  db: Executor,
  job: { readonly id: string; readonly kind: string },
  take: { readonly id: string; readonly creatorId: string },
): Promise<void> {
  if (isBackgroundKind(job.kind) || isTranscribeKind(job.kind)) return;
  try {
    const [step] = await db
      .select({ status: jobStep.status, failureCode: jobStep.failureCode })
      .from(jobStep)
      .where(and(eq(jobStep.jobId, job.id), eq(jobStep.name, "ai_edit")))
      .limit(1);
    const aiEdit = aiEditOutcome(step);
    const [row] = await db
      .select({ n: count() })
      .from(cut)
      .where(and(eq(cut.takeId, take.id), eq(cut.proposedBy, "ai"), eq(cut.applied, true)));
    const cuts = Math.min(row?.n ?? 0, 1000);
    const base = { creatorId: take.creatorId, takeId: take.id } as const;
    await recordJobEvent(db, { ...base, name: "take_ready", props: { aiEdit, cuts } });
    if (aiEdit === "done")
      await recordJobEvent(db, { ...base, name: "ai_edit_used", props: { cuts } });
  } catch {
    logger.error("analytics event failed", { name: "take_ready", takeId: take.id });
  }
}
