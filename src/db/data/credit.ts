import { eq, inArray } from "drizzle-orm";
import {
  CREDIT_CHOICES,
  CREDIT_ENABLED_KEY,
  CREDIT_STARTS_AT_KEY,
  type CreditChoice,
  type CreditSettings,
  creditFor,
  parseCreditSettings,
} from "@/lib/credit-rules";
import { appSetting, take } from "../schema";
import type { Executor } from "../types";

/** The two credit settings, read when a render is created so a change needs no deploy. */
export async function readCreditSettings(db: Executor): Promise<CreditSettings> {
  const rows = await db
    .select({ key: appSetting.key, value: appSetting.value })
    .from(appSetting)
    .where(inArray(appSetting.key, [CREDIT_STARTS_AT_KEY, CREDIT_ENABLED_KEY]));
  return parseCreditSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])));
}

const asChoice = (value: string | null): CreditChoice | null =>
  CREDIT_CHOICES.find((choice) => choice === value) ?? null;

/**
 * Whether the render being created for this take carries the credit (spec 0026 AC-4, AC-5).
 * Called inside `renders.create`'s transaction. Every plan is `free` until billing exists
 * (spec 0024), so only the free rule runs for now. Any failure to read means no credit: it is
 * logged with the take ID only and the render goes on. The read runs in a savepoint, so a
 * failed query cannot abort the render's own transaction.
 */
export async function decideCredit(
  tx: Executor,
  input: { readonly takeId: string; readonly now: Date },
): Promise<boolean> {
  try {
    return await tx.transaction(async (inner) => {
      const [row] = await inner
        .select({ createdAt: take.createdAt, choice: take.creditChoice })
        .from(take)
        .where(eq(take.id, input.takeId));
      if (!row) return false;
      const settings = await readCreditSettings(inner);
      return creditFor({
        plan: "free",
        choice: asChoice(row.choice),
        takeCreatedAt: row.createdAt,
        enabled: settings.enabled,
        startsAt: settings.startsAt,
        now: input.now,
      });
    });
  } catch {
    console.error("credit: could not decide, rendering without it", { takeId: input.takeId });
    return false;
  }
}
