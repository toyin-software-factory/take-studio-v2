import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { CUT_KINDS, CUT_PROPOSERS, CUT_REASON_MAX } from "@/lib/cuts";
import { inList, timestamps } from "./helpers";
import { take } from "./take";

/**
 * A range removed from a take (spec 0002, AC-8). No overlap with another cut of the take,
 * and `end_ms` within the take's length, are enforced in the cuts data functions.
 */
export const cut = pgTable(
  "cut",
  {
    id: uuid("id").primaryKey(),
    takeId: uuid("take_id")
      .notNull()
      .references(() => take.id, { onDelete: "cascade" }),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    kind: text("kind").notNull(),
    proposedBy: text("proposed_by").notNull(),
    reason: text("reason"),
    applied: boolean("applied").notNull().default(true),
    /** Null means the creator never touched this cut, so re analysis may replace it. */
    creatorChangedAt: timestamp("creator_changed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("cut_take_start_idx").on(t.takeId, t.startMs),
    check("cut_range_check", sql`${t.startMs} >= 0 AND ${t.endMs} > ${t.startMs}`),
    check("cut_kind_check", inList(t.kind, CUT_KINDS)),
    check("cut_proposed_by_check", inList(t.proposedBy, CUT_PROPOSERS)),
    check(
      "cut_reason_length_check",
      sql`char_length(${t.reason}) <= ${sql.raw(String(CUT_REASON_MAX))}`,
    ),
  ],
);
