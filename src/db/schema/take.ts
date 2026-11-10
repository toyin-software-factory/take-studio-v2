import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { FAILURE_CODE_VALUES } from "@/lib/failure-codes";
import { CONTAINERS, TAKE_TITLE_MAX, TAKE_TITLE_MIN } from "@/lib/processing";
import { user } from "./auth";
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
    failureCode: text("failure_code"),
    ...timestamps,
  },
  (t) => [
    index("take_creator_created_idx").on(t.creatorId, t.createdAt.desc(), t.id),
    index("take_status_expires_idx").on(t.status, t.videoExpiresAt),
    check(
      "take_title_length_check",
      sql`char_length(${t.title}) BETWEEN ${sql.raw(String(TAKE_TITLE_MIN))} AND ${sql.raw(String(TAKE_TITLE_MAX))}`,
    ),
    check("take_container_check", inList(t.container, CONTAINERS)),
    check("take_failure_code_check", inList(t.failureCode, FAILURE_CODE_VALUES)),
  ],
);
