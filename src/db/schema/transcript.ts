import { jsonb, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import type { TranscriptEdit, TranscriptWord } from "@/lib/transcript-rules";
import { timestamps } from "./helpers";
import { take } from "./take";

/**
 * The transcript of a take (spec 0007; planned in spec 0002). At most one per take. Personal
 * data: database only, deleted with the take, kept after the video expires. Word times are on
 * the original upload; trimmed times are computed at read time, never stored.
 */
export const transcript = pgTable(
  "transcript",
  {
    id: uuid("id").primaryKey(),
    takeId: uuid("take_id")
      .notNull()
      .references(() => take.id, { onDelete: "cascade" }),
    language: text("language").notNull().default("en"),
    /** The provider's full transcript, filler words included. */
    text: text("text").notNull(),
    words: jsonb("words").$type<readonly TranscriptWord[]>().notNull(),
    /** Frame rate of the original (from the task's own probe), so captions use the render's frame aligned cuts. */
    sourceFps: numeric("source_fps", { mode: "number" }).notNull(),
    model: text("model").notNull(),
    /** AI word fixes (spec 0012): at most one per word index; `words` and `text` are never rewritten. */
    edits: jsonb("edits").$type<readonly TranscriptEdit[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [unique("transcript_take_unique").on(t.takeId)],
);
