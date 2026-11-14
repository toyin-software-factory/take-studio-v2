import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * API keys (spec 0018 AC-2). Only the SHA-256 hash of the key is stored, never the key. A key
 * belongs to one creator and is deleted with the account. The cap of 5 per creator is enforced
 * in the create transaction (step 2), not here. Revoking is a hard delete.
 */
export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The first 8 characters after `tsk_`, to tell keys apart in a list. */
    prefix: text("prefix").notNull(),
    /** SHA-256 hex of the full key. Unique, so a lookup by hash finds at most one key. */
    keyHash: text("key_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("api_key_creator_idx").on(t.creatorId)],
);

/**
 * Requests per key per UTC minute (spec 0018 AC-9). One atomic upsert decides the 121st.
 * Rows older than an hour are deleted by the cleanup sweep. Deleted with the key.
 */
export const apiRateWindow = pgTable(
  "api_rate_window",
  {
    keyId: uuid("key_id")
      .notNull()
      .references(() => apiKey.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.keyId, t.windowStart] })],
);
