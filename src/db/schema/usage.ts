import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./helpers";

/**
 * Seconds used per account per UTC month (spec 0014 AC-3). Keyed by the usage account hash
 * (an HMAC of the canonical email), never by an ID or an email, and with no foreign key, so a
 * row survives deleting a take or the account.
 */
export const usageMonth = pgTable(
  "usage_month",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountHash: text("account_hash").notNull(),
    /** First of the month (UTC), `YYYY-MM-01`. */
    month: date("month", { mode: "string" }).notNull(),
    secondsUsed: integer("seconds_used").notNull().default(0),
    /** `USAGE_HASH_VERSION` the hash was made with, so a future canon change can migrate rows. */
    hashVersion: smallint("hash_version").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique("usage_month_account_month_unique").on(t.accountHash, t.month),
    check("usage_month_seconds_used_check", sql`${t.secondsUsed} >= 0`),
  ],
);

/** Small settings read at run time (spec 0014 AC-2, AC-11): changed in the database, no deploy. */
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps,
});
