import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { CONTAINERS, TAKE_TITLE_MAX, TAKE_TITLE_MIN } from "@/lib/processing";
import { user } from "./auth";
import { background } from "./background";
import { inList, takeStatus, timestamps } from "./helpers";

/** One uploaded video take, owned by a creator (spec 0002, slice 1). */
export const take = pgTable(
  "take",
  {
    id: uuid("id").primaryKey(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: takeStatus("status").notNull(),
    originalKey: text("original_key").notNull(),
    originalBytes: bigint("original_bytes", { mode: "number" }).notNull(),
    /** Multipart upload ID; null once the upload is done. */
    uploadId: text("upload_id"),
    container: text("container").notNull(),
    /** Null until the upload is probed. */
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    /** Null until uploaded; upload time + 30 days, never extended. */
    videoExpiresAt: timestamp("video_expires_at", { withTimezone: true }),
    /** How often cleanup re-dispatched the probe for a stored but never probed upload (S1C-T09). */
    probeAttempts: integer("probe_attempts").notNull().default(0),
    /** Open set: validated against the failure code registry in code, no DB CHECK. */
    failureCode: text("failure_code"),
    /**
     * The take's current background (spec 0008); null is the original. Changed only by upload
     * create and by a successful background re render.
     */
    backgroundId: uuid("background_id").references((): AnyPgColumn => background.id, {
      onDelete: "set null",
    }),
    /**
     * Spec 0011: waveform of the original audio, 1 to 1000 integers 0 to 100 evenly spaced over
     * `duration_ms`; null when not computed or no audio. Never log it.
     */
    waveform: jsonb("waveform").$type<readonly number[]>(),
    ...timestamps,
  },
  (t) => [
    index("take_background_idx").on(t.backgroundId),
    index("take_creator_created_idx").on(t.creatorId, t.createdAt.desc(), t.id),
    index("take_status_expires_idx").on(t.status, t.videoExpiresAt),
    check(
      "take_title_length_check",
      sql`char_length(${t.title}) BETWEEN ${sql.raw(String(TAKE_TITLE_MIN))} AND ${sql.raw(String(TAKE_TITLE_MAX))}`,
    ),
    check("take_container_check", inList(t.container, CONTAINERS)),
  ],
);
