import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { BACKGROUND_NAME_MAX, BACKGROUND_NAME_MIN, BACKGROUND_STATUSES } from "@/lib/processing";
import { user } from "./auth";
import { inList, timestamps } from "./helpers";

/**
 * A studio background (spec 0008): one of the built in studios (`creator_id` null) or an image
 * the creator uploaded (private to them). The database stores keys only; files live in R2 and
 * are deleted by exact key. Uploads are `uploading` then `processing` then `ready` or `failed`;
 * built ins are always `ready`.
 */
export const background = pgTable(
  "background",
  {
    id: uuid("id").primaryKey(),
    /** Null for a built in studio. */
    creatorId: text("creator_id").references((): AnyPgColumn => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The uploaded file as sent (null for a built in). */
    sourceKey: text("source_key"),
    /** The normalised JPEG, at most 3840 by 2160. Null until ingest has run. */
    imageKey: text("image_key"),
    /** A 480 by 270 WebP thumbnail. Null until ingest has run. */
    thumbKey: text("thumb_key"),
    /** Size of the normalised image. */
    width: integer("width"),
    height: integer("height"),
    /** The size the creator declared for the upload. */
    bytes: bigint("bytes", { mode: "number" }),
    status: text("status").notNull(),
    /** Why ingest refused the image; open set validated in code, like the job codes. */
    failureCode: text("failure_code"),
    /** Alt text of a built in; uploads use their name. */
    alt: text("alt"),
    ...timestamps,
  },
  (t) => [
    index("background_creator_created_idx").on(t.creatorId, t.createdAt),
    index("background_status_created_idx").on(t.status, t.createdAt),
    check("background_status_check", inList(t.status, BACKGROUND_STATUSES)),
    check(
      "background_name_length_check",
      sql`char_length(${t.name}) BETWEEN ${sql.raw(String(BACKGROUND_NAME_MIN))} AND ${sql.raw(String(BACKGROUND_NAME_MAX))}`,
    ),
    // A ready background has every file and size the render and the picker need.
    check(
      "background_ready_complete_check",
      sql`${t.status} <> 'ready' OR (${t.imageKey} IS NOT NULL AND ${t.thumbKey} IS NOT NULL AND ${t.width} IS NOT NULL AND ${t.height} IS NOT NULL)`,
    ),
  ],
);
