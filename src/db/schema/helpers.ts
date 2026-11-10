import { type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, pgEnum, timestamp } from "drizzle-orm/pg-core";
import { JOB_STATUSES, TAKE_STATUSES } from "@/lib/processing";

/**
 * Shared product timestamps (spec 0002 conventions): `created_at` and `updated_at`, with
 * time zone. Drizzle sets `updated_at` on its own updates; raw SQL in jobs must set it itself.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

/** Postgres enums: the only two categorical fields stored as enums (add values only). */
export const takeStatus = pgEnum("take_status", TAKE_STATUSES);
export const jobStatus = pgEnum("processing_job_status", JOB_STATUSES);

/** Quotes a registry value as an SQL string literal. Registry values are code constants. */
function literal(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Registry value not allowed in SQL: ${value}`);
  return `'${value}'`;
}

/**
 * `column IN ('a', 'b')` from a registry list, inlined as literals (not bind parameters) so
 * drizzle-kit writes the values into CHECKs and partial index WHERE clauses.
 */
export function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${sql.raw(values.map(literal).join(", "))})`;
}
