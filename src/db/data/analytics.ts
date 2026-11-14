import { and, count, eq, gte, sql } from "drizzle-orm";
import type { AnalyticsEventName } from "@/lib/analytics-events";
import { analyticsEvent } from "../schema";
import type { Executor } from "../types";

export type NewAnalyticsRow = {
  readonly name: AnalyticsEventName;
  readonly creatorId: string;
  readonly takeId: string | null;
  readonly props: Readonly<Record<string, unknown>>;
  readonly occurredAt?: Date;
};

/**
 * Inserts one validated event. Idempotent: a row that breaks a once per rule (the unique
 * indexes) is skipped, so a retry or a replayed job never counts twice. Returns whether a row
 * was written. Validation lives in `src/server/analytics/record.ts`.
 */
export async function insertAnalyticsEvent(db: Executor, row: NewAnalyticsRow): Promise<boolean> {
  const written = await db
    .insert(analyticsEvent)
    .values({
      name: row.name,
      creatorId: row.creatorId,
      takeId: row.takeId,
      props: row.props,
      ...(row.occurredAt ? { occurredAt: row.occurredAt } : {}),
    })
    .onConflictDoNothing()
    .returning({ id: analyticsEvent.id });
  return written.length > 0;
}

/** How many events of this name happened since `since` (null: ever). */
export async function countEvents(
  db: Executor,
  name: AnalyticsEventName,
  since: Date | null,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(analyticsEvent)
    .where(
      and(eq(analyticsEvent.name, name), since ? gte(analyticsEvent.occurredAt, since) : sql`true`),
    );
  return row?.n ?? 0;
}
