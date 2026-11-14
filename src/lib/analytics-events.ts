import { z } from "zod";
import { CUT_KINDS, CUT_PROPOSERS } from "./cuts";
import { FAILURE_CODE_VALUES } from "./failure-codes";

/**
 * First party product events (spec 0016). The list is closed: a name not here cannot be
 * recorded. Properties are enums, small integers and booleans only, so a person's words can
 * never reach the table. Pure: no database, no clock.
 */

const smallInt = z.number().int().min(0).max(1000);
const AI_EDIT_OUTCOMES = ["done", "unavailable", "none"] as const;
const DOWNLOAD_KINDS = ["video", "transcript_txt", "transcript_srt", "transcript_vtt"] as const;
const LIMIT_PLACES = ["upload_start", "upload_complete"] as const;

/** Counts of one cut kind for one proposer (spec 0017 AC-1): integers only. */
const cutCount = z.number().int().min(0).max(10_000);
const cutCounts = z
  .object({
    proposed: cutCount,
    undone: cutCount,
    restored: cutCount,
    kept: cutCount,
    added: cutCount,
  })
  .strict();
const countsByKind = z.object(
  Object.fromEntries(CUT_KINDS.map((k) => [k, cutCounts])) as Record<
    (typeof CUT_KINDS)[number],
    typeof cutCounts
  >,
);
const cutsReviewedProps = z
  .object({
    counts: z
      .object(
        Object.fromEntries(CUT_PROPOSERS.map((p) => [p, countsByKind])) as Record<
          (typeof CUT_PROPOSERS)[number],
          typeof countsByKind
        >,
      )
      .strict(),
  })
  .strict();

const timeMs = z.number().int().min(0).max(7_200_000);

/** Property keys no schema may use (AC-3). A test checks every schema against this list. */
export const BLOCKED_PROP_KEYS = [
  "email",
  "name",
  "title",
  "text",
  "transcript",
  "url",
  "ip",
  "file",
] as const;

const empty = z.object({}).strict();

/** Once per rule: `creator` is one row per creator, `take` is one row per take and name. */
export type OncePer = "creator" | "take" | null;

export const ANALYTICS_EVENTS = {
  signup: { props: empty, oncePer: "creator" },
  take_uploaded: { props: empty, oncePer: "take" },
  take_ready: {
    props: z.object({ aiEdit: z.enum(AI_EDIT_OUTCOMES), cuts: smallInt }).strict(),
    oncePer: "take",
  },
  ai_edit_used: { props: z.object({ cuts: smallInt }).strict(), oncePer: "take" },
  change_requested: { props: empty, oncePer: null },
  take_downloaded: { props: z.object({ kind: z.enum(DOWNLOAD_KINDS) }).strict(), oncePer: null },
  transcript_downloaded: {
    props: z.object({ kind: z.enum(DOWNLOAD_KINDS) }).strict(),
    oncePer: null,
  },
  take_failed: {
    props: z.object({ code: z.enum(FAILURE_CODE_VALUES as [string, ...string[]]) }).strict(),
    oncePer: null,
  },
  cuts_reviewed: { props: cutsReviewedProps, oncePer: null },
  cut_missed: {
    props: z.object({ atMs: timeMs, durationMs: timeMs }).strict(),
    oncePer: null,
  },
  limit_hit: { props: z.object({ place: z.enum(LIMIT_PLACES) }).strict(), oncePer: null },
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as readonly AnalyticsEventName[];

/** Names that are kept as long as the account exists (AC-9); the rest expire. */
export const MILESTONE_EVENTS = ANALYTICS_EVENT_NAMES.filter(
  (name) => ANALYTICS_EVENTS[name].oncePer !== null,
);

/** Names with a once per take rule: the partial unique index covers these. */
export const ONCE_PER_TAKE_EVENTS = ANALYTICS_EVENT_NAMES.filter(
  (name) => ANALYTICS_EVENTS[name].oncePer === "take",
);

/** Repeatable events are purged after this many months (AC-9). */
export const ANALYTICS_RETENTION_MONTHS = 13;

/** Founding members: creators with at least this many uploaded takes, out of the target. */
export const FOUNDING_MEMBER_TARGET = 50;
export const FOUNDING_MEMBER_MIN_TAKES = 2;

/** The reporting windows on /insights, default 30 days. */
export const INSIGHTS_WINDOWS = ["7d", "30d", "all"] as const;
export type InsightsWindow = (typeof INSIGHTS_WINDOWS)[number];
export const DEFAULT_INSIGHTS_WINDOW: InsightsWindow = "30d";
export const insightsWindowSchema = z.enum(INSIGHTS_WINDOWS).catch(DEFAULT_INSIGHTS_WINDOW);

/** The take ID field: required and non null for a once per take event, optional otherwise. */
type TakeIdField<N extends AnalyticsEventName> =
  (typeof ANALYTICS_EVENTS)[N]["oncePer"] extends "take"
    ? { readonly takeId: string }
    : { readonly takeId?: string | null };

/** One event to record: the name, who, which take, and its validated properties. */
export type AnalyticsEventInput = {
  readonly [N in AnalyticsEventName]: {
    readonly name: N;
    readonly creatorId: string;
    readonly props?: z.input<(typeof ANALYTICS_EVENTS)[N]["props"]>;
    readonly occurredAt?: Date;
  } & TakeIdField<N>;
}[AnalyticsEventName];

/**
 * Runtime twin of the type: a once per take event with no take ID would escape the partial
 * unique index and could be written twice, so it is refused (AC-4).
 */
export function hasRequiredTakeId(name: AnalyticsEventName, takeId: string | null | undefined) {
  return ANALYTICS_EVENTS[name].oncePer !== "take" || (typeof takeId === "string" && takeId !== "");
}

/** Validates one event's properties against its strict schema; `null` means refused (AC-2, AC-3). */
export function parseEventProps(
  name: AnalyticsEventName,
  props: unknown,
): Readonly<Record<string, unknown>> | null {
  const parsed = ANALYTICS_EVENTS[name].props.safeParse(props ?? {});
  return parsed.success ? parsed.data : null;
}

export type AiEditOutcome = (typeof AI_EDIT_OUTCOMES)[number];

/**
 * How a job's AI edit ended, read from its persisted `ai_edit` step row (never from a return
 * value): succeeded is `done`, skipped with `ai_unavailable` is `unavailable`, anything else
 * (another status or code, or no row) is `none`. Same rule as `aiEditState` in the take detail.
 */
export function aiEditOutcome(
  step: { readonly status: string; readonly failureCode: string | null } | undefined,
): AiEditOutcome {
  if (step?.status === "succeeded") return "done";
  if (step?.status === "skipped" && step.failureCode === "ai_unavailable") return "unavailable";
  return "none";
}
