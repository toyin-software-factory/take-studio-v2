import { readUsageSettings } from "@/db/data/usage";
import type { Executor } from "@/db/types";
import { PUBLIC_VIEWER, type LegalNow } from "@/lib/legal-facts";
import { monthlyAllowanceSeconds } from "@/lib/usage-rules";

/**
 * The allowance the public pages show (spec 0015 value sourcing): the settings read at request
 * time, for the fixed public viewer and never the reader's own account. `null` when the read
 * fails, so the page says "temporarily unavailable" instead of showing a default as current.
 */
export async function legalAllowance(
  getDb: () => Promise<Executor>,
): Promise<LegalNow["allowance"]> {
  try {
    const settings = await readUsageSettings(await getDb());
    return {
      minutes: monthlyAllowanceSeconds(settings, PUBLIC_VIEWER) / 60,
      limitEnabled: settings.limitEnabled,
    };
  } catch {
    return null;
  }
}
