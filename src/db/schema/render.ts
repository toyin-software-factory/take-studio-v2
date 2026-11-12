import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { RENDER_STATUSES } from "@/lib/processing";
import { background } from "./background";
import { inList, timestamps } from "./helpers";
import { processingJob } from "./processing";
import { take } from "./take";

/** A removed range as snapshotted on a render, in milliseconds of the original upload. */
export type RemovedRange = { readonly startMs: number; readonly endMs: number };

/**
 * One render of a take (spec 0002, AC-10). Only the latest succeeded render keeps a video
 * file; `removed_ranges` is the snapshot of applied cuts taken at render step start.
 */
export const render = pgTable(
  "render",
  {
    id: uuid("id").primaryKey(),
    takeId: uuid("take_id")
      .notNull()
      .references(() => take.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => processingJob.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    /** Set only on success: `renders/{takeId}/{renderId}.mp4`. */
    videoKey: text("video_key"),
    durationMs: integer("duration_ms"),
    removedRanges: jsonb("removed_ranges").$type<readonly RemovedRange[]>().notNull(),
    isLatest: boolean("is_latest").notNull().default(false),
    /** Spec 0008: the background this render was made for, snapshot at render start. */
    backgroundId: uuid("background_id").references((): AnyPgColumn => background.id, {
      onDelete: "set null",
    }),
    /** Kept when the background is deleted, so the take page can still name it. */
    backgroundName: text("background_name"),
    /** True only when the green was actually replaced (a skipped `no_green_screen` is false). */
    keyed: boolean("keyed").notNull().default(false),
    /** The detected key colour as hex (null when not keyed). */
    keyColor: text("key_color"),
    ...timestamps,
  },
  (t) => [
    // At most one latest render per take.
    uniqueIndex("render_one_latest_per_take_uidx")
      .on(t.takeId)
      .where(sql`${t.isLatest}`),
    index("render_take_idx").on(t.takeId),
    index("render_job_idx").on(t.jobId),
    check("render_status_check", inList(t.status, RENDER_STATUSES)),
  ],
);
