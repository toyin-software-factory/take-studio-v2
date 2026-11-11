import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Better Auth's database rate limit storage (spec 0006, AC-4): Workers have no shared memory,
 * so the per IP counters live here. Shape fixed by Better Auth (`rateLimit` model: key, count,
 * lastRequest in ms).
 */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/**
 * One row per sign in link request, keyed by a hash of the lowercased email (never the email
 * itself), for the "3 per email per 15 minutes" limit (AC-4). Old rows are pruned as new ones
 * are written.
 */
export const signInEmailAttempt = pgTable(
  "sign_in_email_attempt",
  {
    id: uuid("id").primaryKey(),
    emailKey: text("email_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sign_in_email_attempt_key_created_idx").on(t.emailKey, t.createdAt)],
);
