import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ACTIVE_JOB_STATUSES, JOB_KINDS, STEP_NAMES, STEP_STATUSES } from "@/lib/processing";
import { background } from "./background";
import { inList, jobStatus, timestamps } from "./helpers";
import { take } from "./take";

/** One processing run on a take (spec 0002, slice 1). */
export const processingJob = pgTable(
  "processing_job",
  {
    id: uuid("id").primaryKey(),
    takeId: uuid("take_id")
      .notNull()
      .references(() => take.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: jobStatus("status").notNull(),
    triggerRunId: text("trigger_run_id"),
    secondsCharged: integer("seconds_charged").notNull(),
    /** First of the month (UTC) the charge counts against; null if nothing was charged. */
    chargedMonth: date("charged_month", { mode: "string" }),
    /** Usage account hash the charge counts against; null if nothing was charged. */
    chargedAccountHash: text("charged_account_hash"),
    refunded: boolean("refunded").notNull().default(false),
    /** Open set: validated against the failure code registry in code, no DB CHECK. */
    failureCode: text("failure_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Spec 0006, AC-5: when this job's "take ready or failed" email was sent; null until then. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** The background this job renders onto (spec 0008); null is the original. */
    targetBackgroundId: uuid("target_background_id").references((): AnyPgColumn => background.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("processing_job_target_background_idx").on(t.targetBackgroundId),
    // AC-4: at most one queued or running job per take.
    uniqueIndex("processing_job_one_active_per_take_uidx")
      .on(t.takeId)
      .where(inList(t.status, ACTIVE_JOB_STATUSES)),
    index("processing_job_take_created_idx").on(t.takeId, t.createdAt.desc()),
    index("processing_job_status_updated_idx").on(t.status, t.updatedAt),
    check("processing_job_kind_check", inList(t.kind, JOB_KINDS)),
    check("processing_job_seconds_charged_check", sql`${t.secondsCharged} >= 0`),
  ],
);

/** One step of a job, from the fixed step list per kind (spec 0002, AC-7). */
export const jobStep = pgTable(
  "job_step",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => processingJob.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: smallint("position").notNull(),
    status: text("status").notNull(),
    progress: smallint("progress").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Open set: validated against the failure code registry in code, no DB CHECK. */
    failureCode: text("failure_code"),
    ...timestamps,
  },
  (t) => [
    unique("job_step_job_name_unique").on(t.jobId, t.name),
    check("job_step_progress_check", sql`${t.progress} BETWEEN 0 AND 100`),
    check("job_step_name_check", inList(t.name, STEP_NAMES)),
    check("job_step_status_check", inList(t.status, STEP_STATUSES)),
  ],
);
