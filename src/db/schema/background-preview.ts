import { boolean, check, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { PREVIEW_STATUSES } from "@/lib/processing";
import { background } from "./background";
import { inList, timestamps } from "./helpers";
import { take } from "./take";

/**
 * A still preview of a take on a background (spec 0008, AC-4), cached per take, background and
 * cut version. "Original" previews never use this table. Deleted with the take or the background.
 */
export const backgroundPreview = pgTable(
  "background_preview",
  {
    id: uuid("id").primaryKey(),
    takeId: uuid("take_id")
      .notNull()
      .references(() => take.id, { onDelete: "cascade" }),
    backgroundId: uuid("background_id")
      .notNull()
      .references(() => background.id, { onDelete: "cascade" }),
    /** Hash of the take's applied cut ranges when the preview was made. */
    cutVersion: text("cut_version").notNull(),
    status: text("status").notNull(),
    /** Null until ready: `previews/{takeId}/{previewId}.jpg`. */
    objectKey: text("object_key"),
    /** True when the take has no usable green screen: the preview shows the plain frame. */
    noGreenScreen: boolean("no_green_screen").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique("background_preview_take_background_cut_unique").on(
      t.takeId,
      t.backgroundId,
      t.cutVersion,
    ),
    index("background_preview_background_idx").on(t.backgroundId),
    check("background_preview_status_check", inList(t.status, PREVIEW_STATUSES)),
  ],
);
