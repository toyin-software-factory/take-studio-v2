import { eq } from "drizzle-orm";
import { getUsedSeconds, readUsageSettings } from "@/db/data/usage";
import { user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { chargedMonth } from "@/lib/billing";
import { type Result, err, ok } from "@/lib/result";
import { usageAccountHash } from "@/lib/usage-hash";
import { type UsageSummary, monthlyAllowanceSeconds, usageSummary } from "@/lib/usage-rules";

/**
 * The creator's usage for the current UTC month (spec 0014 AC-7, AC-8). The email is read here
 * and turned into the account hash on the server; neither leaves this function. `enforced` says
 * whether the limit is switched on, so callers that refuse (the upload) do nothing while it is off.
 */
export type CreatorUsage = UsageSummary & { readonly enforced: boolean };

export async function usageForCreator(
  db: Executor,
  input: { readonly creatorId: string; readonly usageSecret: string; readonly now: Date },
): Promise<Result<CreatorUsage, "not_found">> {
  const [found] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, input.creatorId));
  if (!found) return err("not_found");
  const accountHash = await usageAccountHash(found.email, input.usageSecret);
  const settings = await readUsageSettings(db);
  const used = await getUsedSeconds(db, { accountHash, month: chargedMonth(input.now) });
  const allowance = monthlyAllowanceSeconds(settings, { accountHash });
  return ok({ ...usageSummary(allowance, used, input.now), enforced: settings.limitEnabled });
}

/** The four numbers a `limit_exceeded` body carries (no flag, no hash). */
export function usageNumbers(usage: UsageSummary): UsageSummary {
  const { usedSeconds, allowanceSeconds, remainingSeconds, resetsOn } = usage;
  return { usedSeconds, allowanceSeconds, remainingSeconds, resetsOn };
}

/** Headers for every response that carries usage numbers (AC-8). */
export const PRIVATE_NO_STORE = { "cache-control": "private, no-store" } as const;
