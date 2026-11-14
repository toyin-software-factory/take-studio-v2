import { insertAnalyticsEvent } from "@/db/data/analytics";
import type { Executor } from "@/db/types";
import {
  hasRequiredTakeId,
  parseEventProps,
  type AnalyticsEventInput,
} from "@/lib/analytics-events";
import { type Result, err, ok } from "@/lib/result";

export type RecordError = "invalid" | "failed";

/**
 * Records one product event (spec 0016, AC-2, AC-3, AC-6). Best effort: it validates the
 * properties, writes once, never throws, and logs only the event name and take ID on a
 * failure. Call it after the main work has committed, never inside the user's transaction.
 * `data` is true when a row was written, false when a once per rule skipped it.
 */
export async function recordEvent(
  db: Executor,
  event: AnalyticsEventInput,
): Promise<Result<boolean, RecordError>> {
  const props = parseEventProps(event.name, event.props);
  if (!props || !hasRequiredTakeId(event.name, event.takeId)) {
    console.error("analytics event refused", { name: event.name, takeId: event.takeId ?? null });
    return err("invalid");
  }
  try {
    const written = await insertAnalyticsEvent(db, {
      name: event.name,
      creatorId: event.creatorId,
      takeId: event.takeId ?? null,
      props,
      ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
    });
    return ok(written);
  } catch {
    console.error("analytics event failed", { name: event.name, takeId: event.takeId ?? null });
    return err("failed");
  }
}
