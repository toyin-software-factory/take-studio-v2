import { parseUsageEnv, parseWebEnv } from "@/lib/env";
import { createR2 } from "@/lib/r2";
import { getDb, getSession } from "../request";
import type { ClaimDeps } from "./claim";
import type { ClaimHttpDeps } from "./claim-http";

/** The real database and storage for a claim (the page and the confirm route both use it). */
export async function realClaimDeps(): Promise<ClaimDeps> {
  return {
    db: await getDb(),
    r2: createR2(parseWebEnv()),
    usageSecret: parseUsageEnv().USAGE_HASH_SECRET,
  };
}

export function guestClaimHttpDeps(): ClaimHttpDeps {
  const url = new URL(parseWebEnv().BETTER_AUTH_URL);
  return {
    appOrigin: url.origin,
    secureCookie: url.protocol === "https:",
    signedInUserId: async (request) => (await getSession(request.headers))?.user.id ?? null,
    claimDeps: realClaimDeps,
  };
}
