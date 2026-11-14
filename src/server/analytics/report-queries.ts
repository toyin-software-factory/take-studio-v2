import { and, count, countDistinct, eq, gte, sql } from "drizzle-orm";
import { analyticsEvent } from "@/db/schema";
import type { Executor } from "@/db/types";
import { FOUNDING_MEMBER_MIN_TAKES, type AnalyticsEventName } from "@/lib/analytics-events";

/** Aggregate queries for /insights. Every one returns numbers only, never a creator row. */

const inWindow = (since: Date | null) =>
  since ? gte(analyticsEvent.occurredAt, since) : sql`true`;

/** Events of one name in the window. */
export async function eventCount(db: Executor, name: AnalyticsEventName, since: Date | null) {
  const [row] = await db
    .select({ n: count() })
    .from(analyticsEvent)
    .where(and(eq(analyticsEvent.name, name), inWindow(since)));
  return row?.n ?? 0;
}

/** Distinct creators with an event of this name in the window, optionally on one `props.kind`. */
export async function creatorCount(
  db: Executor,
  name: AnalyticsEventName,
  since: Date | null,
  kind?: string,
) {
  const [row] = await db
    .select({ n: countDistinct(analyticsEvent.creatorId) })
    .from(analyticsEvent)
    .where(
      and(
        eq(analyticsEvent.name, name),
        inWindow(since),
        kind ? sql`${analyticsEvent.props}->>'kind' = ${kind}` : sql`true`,
      ),
    );
  return row?.n ?? 0;
}

/** Creators whose second upload happened in the window (all time history, then its time). */
export async function secondTakeCount(db: Executor, since: Date | null) {
  const second = db
    .select({
      secondAt:
        sql<Date>`(array_agg(${analyticsEvent.occurredAt} order by ${analyticsEvent.occurredAt}))[2]`.as(
          "second_at",
        ),
    })
    .from(analyticsEvent)
    .where(eq(analyticsEvent.name, "take_uploaded"))
    .groupBy(analyticsEvent.creatorId)
    .having(sql`count(*) >= ${FOUNDING_MEMBER_MIN_TAKES}`)
    .as("second");
  const [row] = await db
    .select({ n: count() })
    .from(second)
    .where(since ? sql`${second.secondAt} >= ${since.toISOString()}::timestamptz` : sql`true`);
  return row?.n ?? 0;
}

/** Ready events in the window, and how many of them had a finished AI edit. */
export async function aiEditShare(db: Executor, since: Date | null) {
  const [row] = await db
    .select({
      ready: count(),
      done: sql<number>`count(*) filter (where ${analyticsEvent.props}->>'aiEdit' = 'done')`.mapWith(
        Number,
      ),
    })
    .from(analyticsEvent)
    .where(and(eq(analyticsEvent.name, "take_ready"), inWindow(since)));
  return { ready: row?.ready ?? 0, done: row?.done ?? 0 };
}

/** Failures in the window by failure code, most common first. */
export async function failuresByCode(db: Executor, since: Date | null) {
  const code = sql<string>`${analyticsEvent.props}->>'code'`;
  const rows = await db
    .select({ code, n: count() })
    .from(analyticsEvent)
    .where(and(eq(analyticsEvent.name, "take_failed"), inWindow(since)))
    .groupBy(code)
    .orderBy(sql`count(*) desc`, code);
  return rows.map((r) => ({ code: r.code, count: r.n }));
}
