import { and, eq, inArray, sql } from "drizzle-orm";
import { USAGE_HASH_VERSION } from "@/lib/usage-hash";
import {
  FREE_MONTHLY_SECONDS_KEY,
  USAGE_LIMIT_ENABLED_KEY,
  type UsageSettings,
  parseUsageSettings,
} from "@/lib/usage-rules";
import { appSetting, usageMonth } from "../schema";
import type { Executor, Tx } from "../types";

/** Largest `integer`: the "no ceiling" allowance while the limit is switched off (AC-11). */
const NO_CEILING = 2_147_483_647;

/** The two usage settings, read at the time of the check so a change needs no deploy (AC-2). */
export async function readUsageSettings(db: Executor): Promise<UsageSettings> {
  const rows = await db
    .select({ key: appSetting.key, value: appSetting.value })
    .from(appSetting)
    .where(inArray(appSetting.key, [FREE_MONTHLY_SECONDS_KEY, USAGE_LIMIT_ENABLED_KEY]));
  return parseUsageSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])));
}

/** Seconds used by this account in this month (`YYYY-MM-01`); 0 when there is no row. */
export async function getUsedSeconds(
  db: Executor,
  input: { readonly accountHash: string; readonly month: string },
): Promise<number> {
  const [row] = await db
    .select({ secondsUsed: usageMonth.secondsUsed })
    .from(usageMonth)
    .where(and(eq(usageMonth.accountHash, input.accountHash), eq(usageMonth.month, input.month)));
  return row?.secondsUsed ?? 0;
}

/**
 * Adds `seconds` to the account's month in one statement (spec 0014 AC-4):
 * `insert ... on conflict do update ... where seconds_used + c <= allowance returning`.
 * The insert side happens only when `c <= allowance`. Zero rows back means the charge does not
 * fit and nothing changed, so two starts for one account can never total more than the
 * allowance. With `enforce` false (the limit is switched off) the ceiling is the integer
 * maximum, so the charge is still recorded. Call it inside the caller's transaction.
 */
export async function chargeUsage(
  tx: Tx,
  input: {
    readonly accountHash: string;
    readonly month: string;
    readonly seconds: number;
    readonly allowance: number;
    readonly enforce: boolean;
  },
): Promise<boolean> {
  const ceiling = input.enforce ? input.allowance : NO_CEILING;
  const rows = await tx.execute(sql`
    INSERT INTO usage_month (account_hash, month, seconds_used, hash_version)
    SELECT ${input.accountHash}::text, ${input.month}::date, ${input.seconds}::integer,
      ${USAGE_HASH_VERSION}::smallint
    WHERE ${input.seconds}::integer <= ${ceiling}::integer
    ON CONFLICT (account_hash, month) DO UPDATE
      SET seconds_used = usage_month.seconds_used + EXCLUDED.seconds_used, updated_at = now()
      WHERE usage_month.seconds_used + EXCLUDED.seconds_used <= ${ceiling}::integer
    RETURNING seconds_used`);
  return rows.length > 0;
}

/**
 * Gives `seconds` back to the month that was charged (AC-5), never below 0, in the caller's
 * transaction. A month with no row is left alone.
 */
export async function returnUsage(
  tx: Tx,
  input: { readonly accountHash: string; readonly month: string; readonly seconds: number },
): Promise<void> {
  await tx
    .update(usageMonth)
    .set({ secondsUsed: sql`greatest(0, ${usageMonth.secondsUsed} - ${input.seconds})` })
    .where(and(eq(usageMonth.accountHash, input.accountHash), eq(usageMonth.month, input.month)));
}
