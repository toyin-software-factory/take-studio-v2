import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ANALYTICS_EVENT_NAMES, ONCE_PER_TAKE_EVENTS } from "@/lib/analytics-events";
import { user } from "./auth";
import { inList } from "./helpers";
import { take } from "./take";

/**
 * First party product events (spec 0016). IDs, a time and a validated code only: never an
 * email, name, title, transcript word or link. Deleting the account deletes its events;
 * deleting a take keeps the event and clears the take ID.
 */
export const analyticsEvent = pgTable(
  "analytics_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    takeId: uuid("take_id").references(() => take.id, { onDelete: "set null" }),
    props: jsonb("props").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("analytics_event_name_check", inList(t.name, ANALYTICS_EVENT_NAMES)),
    index("analytics_event_name_time_idx").on(t.name, t.occurredAt),
    index("analytics_event_creator_name_idx").on(t.creatorId, t.name),
    uniqueIndex("analytics_event_signup_once_uidx")
      .on(t.creatorId)
      .where(sql`${t.name} = 'signup'`),
    uniqueIndex("analytics_event_once_per_take_uidx")
      .on(t.takeId, t.name)
      .where(sql`${inList(t.name, ONCE_PER_TAKE_EVENTS)} and ${t.takeId} is not null`),
  ],
);
