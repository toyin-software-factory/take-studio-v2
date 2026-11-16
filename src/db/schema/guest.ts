import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

/**
 * Upload first, sign in after (spec 0023). One row per guest: the hash of the `ts_guest` cookie
 * token, the typed email (lowercased) and its usage hash, the hashed network address, a parked
 * claim and the 24 hour expiry. Deleting the guest user deletes the row. The email, both hashes
 * and the token hash are personal data: never log them, send them to Sentry or put them in an
 * analytics event.
 */
export const guestClaim = pgTable(
  "guest_claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestUserId: text("guest_user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    /** SHA 256 hex of the cookie token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    email: text("email"),
    emailHash: text("email_hash"),
    ipHash: text("ip_hash").notNull(),
    /** Set when the claim is parked because a take is still uploading (step 5). */
    claimUserId: text("claim_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** The last drop plus 24 hours, moved forward on each drop. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    emailSends: integer("email_sends").notNull().default(0),
  },
  (t) => [
    index("guest_claim_expires_at_idx").on(t.expiresAt),
    check("guest_claim_email_sends_check", sql`${t.emailSends} >= 0`),
  ],
);

/** Drops per hashed address per UTC day (AC-6). Claims never lower it. Swept after 2 days. */
export const guestIpDay = pgTable(
  "guest_ip_day",
  {
    ipHash: text("ip_hash").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    drops: integer("drops").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "guest_ip_day_pk", columns: [t.ipHash, t.day] }),
    check("guest_ip_day_drops_check", sql`${t.drops} >= 0`),
  ],
);

/** Minutes reserved against the global guest budget per UTC day (AC-6, AC-8; step 3). */
export const guestBudgetDay = pgTable(
  "guest_budget_day",
  {
    day: date("day", { mode: "string" }).primaryKey(),
    reservedMinutes: integer("reserved_minutes").notNull().default(0),
  },
  (t) => [check("guest_budget_day_minutes_check", sql`${t.reservedMinutes} >= 0`)],
);
