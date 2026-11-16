import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CONTAINERS,
  SCRIPT_MAX_CHARS,
  TAKE_SOURCES,
  TAKE_TITLE_MAX,
  TAKE_TITLE_MIN,
} from "@/lib/processing";
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
    /**
     * Spec 0012: the built in background the AI suggested (validated against the catalog in
     * code); null when none. Nothing is applied by itself.
     */
    suggestedBackgroundId: uuid("suggested_background_id").references(
      (): AnyPgColumn => background.id,
      { onDelete: "set null" },
    ),
    /** The suggestion's one line reason (at most 280); ignored when the ID is null. Never log it. */
    suggestionReason: text("suggestion_reason"),
    /** Spec 0021: `file` (chosen) or `recording` (made in the app). Set at upload create. */
    source: text("source").notNull().default("file"),
    /** Spec 0026: a paid creator's choice about the credit, `on` or `off`; null is no choice made. */
    creditChoice: text("credit_choice"),
    /**
     * Spec 0021: the script the creator read from, trimmed, at most 20000 characters; null for
     * none. Personal data: never log it, send it to Sentry, analytics, a job payload or a URL.
     */
    script: text("script"),
    /**
     * Spec 0023: set when a guest drop creates the take, never cleared. Job start reads it to
     * let the one take that crosses the 60 minute ceiling through (AC-8).
     */
    guestOrigin: boolean("guest_origin").notNull().default(false),
    /** Spec 0023: minutes reserved against the day's guest budget (step 3); null once released. */
    guestReservedMinutes: integer("guest_reserved_minutes"),
    /** Spec 0023: the UTC day of that reservation, written and cleared with the minutes. */
    guestReservedDay: date("guest_reserved_day", { mode: "string" }),
    ...timestamps,
  },
  (t) => [
    index("take_background_idx").on(t.backgroundId),
    index("take_suggested_background_idx").on(t.suggestedBackgroundId),
    index("take_creator_created_idx").on(t.creatorId, t.createdAt.desc(), t.id),
    index("take_status_expires_idx").on(t.status, t.videoExpiresAt),
    check(
      "take_title_length_check",
      sql`char_length(${t.title}) BETWEEN ${sql.raw(String(TAKE_TITLE_MIN))} AND ${sql.raw(String(TAKE_TITLE_MAX))}`,
    ),
    check("take_container_check", inList(t.container, CONTAINERS)),
    check("take_source_check", inList(t.source, TAKE_SOURCES)),
    check(
      "take_credit_choice_check",
      sql`${t.creditChoice} IS NULL OR ${t.creditChoice} IN ('on', 'off')`,
    ),
    check(
      "take_script_length_check",
      sql`${t.script} IS NULL OR char_length(${t.script}) <= ${sql.raw(String(SCRIPT_MAX_CHARS))}`,
    ),
    check(
      "take_suggestion_reason_length_check",
      sql`${t.suggestionReason} IS NULL OR char_length(${t.suggestionReason}) <= 280`,
    ),
  ],
);
