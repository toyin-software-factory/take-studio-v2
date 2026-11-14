import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { readUsageSettings } from "../../src/db/data/usage";
import * as schema from "../../src/db/schema";
import {
  LEGAL_ENTITY,
  LEGAL_VERSION,
  PUBLIC_VIEWER,
  REVIEW,
  type LegalNow,
  draftReasons,
} from "../../src/lib/legal-facts";
import { monthlyAllowanceSeconds } from "../../src/lib/usage-rules";

/**
 * The launch gate (spec 0015 AC-8, AC-11): `pnpm test:legal-launch`, run before the switch to
 * launch and never in the normal suite. It passes only when every entity and review value is
 * set, the reviewed versions, text hashes and allowance match the live ones, and the Draft banner
 * would be off. The allowance is read from the database `DATABASE_URL_DIRECT` points at (the
 * launch database); if it cannot be read the gate fails, it never passes on a guess. The page
 * text hashes come with the pages (step 2); until then they are `null` and the gate fails.
 */

/** Hashes of the live page text; `null` until the pages exist. */
function pageHashes(): Pick<LegalNow, "privacyTextHash" | "termsTextHash"> {
  return { privacyTextHash: null, termsTextHash: null };
}

async function readAllowance(): Promise<LegalNow["allowance"]> {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) return null;
  const host = new URL(url).hostname;
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  // Read only, but the same guard as the other scripts: a remote database must be chosen on purpose.
  if (!local && process.env.CI !== "true" && process.env.MIGRATE_TARGET !== "prod") return null;
  const client = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    const settings = await readUsageSettings(drizzle(client, { schema }));
    return {
      minutes: monthlyAllowanceSeconds(settings, PUBLIC_VIEWER) / 60,
      limitEnabled: settings.limitEnabled,
    };
  } catch {
    return null;
  } finally {
    await client.end({ timeout: 5 }).catch(() => undefined);
  }
}

describe("legal launch gate", () => {
  it("has nothing left to supply or review, and the Draft banner is off", async () => {
    const now: LegalNow = { ...pageHashes(), allowance: await readAllowance() };
    const reasons = draftReasons({
      entity: LEGAL_ENTITY,
      review: REVIEW,
      version: LEGAL_VERSION,
      now,
    });
    expect(reasons, "launch is blocked until these are resolved").toEqual([]);
  });
});
