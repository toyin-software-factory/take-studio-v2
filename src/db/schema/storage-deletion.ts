import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Queue of stored files to delete (spec 0002, AC-17). No foreign key: rows outlive the
 * take or account they came from. Every file key removed from a row lands here in the
 * same transaction; the `storage-deletion` task drains it with retries.
 */
export const storageDeletion = pgTable(
  "storage_deletion",
  {
    id: uuid("id").primaryKey(),
    objectKey: text("object_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("storage_deletion_created_idx").on(t.createdAt)],
);
