import { and, inArray, lt, sql } from "drizzle-orm";
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_RETENTION_MONTHS,
  type AnalyticsEventName,
} from "@/lib/analytics-events";
import { JOB_KINDS, isBackgroundKind, isTranscribeKind } from "@/lib/processing";
import { VIDEO_RETENTION_DAYS } from "@/lib/take-rules";
import { analyticsEvent } from "../schema";
import type { Executor } from "../types";

/** Per rule rows to insert in one run. The sweep uses the default; the backfill loops. */
export const REPAIR_BATCH = 500;
/** Rows deleted per statement when purging old repeatable events. */
export const PURGE_BATCH = 1000;

export type RepairCounts = Readonly<
  Record<"signup" | "take_uploaded" | "take_ready" | "ai_edit_used", number>
>;

/** Job kinds that own a take's video: `take_ready` and `ai_edit_used` only come from these. */
const VIDEO_KINDS = JOB_KINDS.filter((kind) => !isBackgroundKind(kind) && !isTranscribeKind(kind));
const kindList = sql.join(
  VIDEO_KINDS.map((kind) => sql`${kind}`),
  sql`, `,
);

const AI_OUTCOME = sql`case
  when s.status = 'succeeded' then 'done'
  when s.status = 'skipped' and s.failure_code = 'ai_unavailable' then 'unavailable'
  else 'none' end`;
const AI_CUTS = sql`least(1000, (select count(*) from cut c
  where c.take_id = t.id and c.proposed_by = 'ai' and c.applied))`;

/**
 * One statement per once per rule: insert the event for every real row that has none, with the
 * real row's own time (spec 0016 AC-6). Same idempotent insert as the recorder (`ON CONFLICT DO
 * NOTHING` on the partial unique indexes), so a repair and a live event can never double count
 * and a second run finds nothing. `take_uploaded` uses the probe time derived from
 * `video_expires_at`; `take_ready` and `ai_edit_used` use the first succeeded video job, and
 * `cuts` is the applied AI cut count as stored now.
 */
const STATEMENTS = (limit: number) =>
  ({
    signup: sql`insert into analytics_event (name, creator_id, take_id, props, occurred_at)
      select 'signup', u.id, null, '{}'::jsonb, u.created_at at time zone 'UTC'
      from "user" u
      where not exists (select 1 from analytics_event e where e.creator_id = u.id and e.name = 'signup')
      order by u.created_at limit ${limit}
      on conflict do nothing returning id`,
    take_uploaded: sql`insert into analytics_event (name, creator_id, take_id, props, occurred_at)
      select 'take_uploaded', t.creator_id, t.id, '{}'::jsonb,
        t.video_expires_at - make_interval(days => ${VIDEO_RETENTION_DAYS})
      from take t
      where t.video_expires_at is not null
        and not exists (select 1 from analytics_event e where e.take_id = t.id and e.name = 'take_uploaded')
      order by t.video_expires_at limit ${limit}
      on conflict do nothing returning id`,
    take_ready: sql`insert into analytics_event (name, creator_id, take_id, props, occurred_at)
      select 'take_ready', t.creator_id, t.id,
        jsonb_build_object('aiEdit', ${AI_OUTCOME}, 'cuts', ${AI_CUTS}), j.finished_at
      from (
        select distinct on (pj.take_id) pj.id, pj.take_id, pj.finished_at
        from processing_job pj
        where pj.status = 'succeeded' and pj.finished_at is not null and pj.kind in (${kindList})
          and not exists (select 1 from analytics_event e where e.take_id = pj.take_id and e.name = 'take_ready')
        order by pj.take_id, pj.finished_at, pj.id
      ) j
      join take t on t.id = j.take_id
      left join job_step s on s.job_id = j.id and s.name = 'ai_edit'
      order by j.finished_at limit ${limit}
      on conflict do nothing returning id`,
    ai_edit_used: sql`insert into analytics_event (name, creator_id, take_id, props, occurred_at)
      select 'ai_edit_used', t.creator_id, t.id, jsonb_build_object('cuts', ${AI_CUTS}), s.finished_at
      from (
        select distinct on (pj.take_id) pj.take_id, js.finished_at
        from job_step js
        join processing_job pj on pj.id = js.job_id
        where js.name = 'ai_edit' and js.status = 'succeeded' and js.finished_at is not null
          and pj.kind in (${kindList})
          and not exists (select 1 from analytics_event e where e.take_id = pj.take_id and e.name = 'ai_edit_used')
        order by pj.take_id, js.finished_at
      ) s
      join take t on t.id = s.take_id
      order by s.finished_at limit ${limit}
      on conflict do nothing returning id`,
  }) satisfies Record<keyof RepairCounts, ReturnType<typeof sql>>;

/**
 * Inserts the milestone events that are missing (AC-6 repair, AC-12 backfill). Returns how many
 * rows each rule added. Counts only: never IDs, never anything a person wrote.
 */
export async function repairAnalyticsEvents(
  db: Executor,
  limit: number = REPAIR_BATCH,
): Promise<RepairCounts> {
  const statements = STATEMENTS(limit);
  const added = { signup: 0, take_uploaded: 0, take_ready: 0, ai_edit_used: 0 };
  for (const name of Object.keys(added) as (keyof RepairCounts)[]) {
    added[name] = (await db.execute(statements[name])).length;
  }
  return added;
}

/** Names that expire (AC-9): the events with no once per rule. */
const REPEATABLE_EVENTS: readonly AnalyticsEventName[] = ANALYTICS_EVENT_NAMES.filter(
  (name) => ANALYTICS_EVENTS[name].oncePer === null,
);

/**
 * Deletes one batch of repeatable events older than `ANALYTICS_RETENTION_MONTHS` (AC-9).
 * Milestone events are never purged. Returns how many rows went; the next sweep continues.
 */
export async function purgeOldAnalyticsEvents(
  db: Executor,
  now: Date,
  batch: number = PURGE_BATCH,
): Promise<number> {
  const cutoff = sql`${now.toISOString()}::timestamptz - make_interval(months => ${ANALYTICS_RETENTION_MONTHS})`;
  const old = db
    .select({ id: analyticsEvent.id })
    .from(analyticsEvent)
    .where(
      and(
        inArray(analyticsEvent.name, [...REPEATABLE_EVENTS]),
        lt(analyticsEvent.occurredAt, cutoff),
      ),
    )
    .orderBy(analyticsEvent.occurredAt)
    .limit(batch);
  const removed = await db
    .delete(analyticsEvent)
    .where(inArray(analyticsEvent.id, old))
    .returning({ id: analyticsEvent.id });
  return removed.length;
}
