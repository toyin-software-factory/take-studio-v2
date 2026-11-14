import { parseUsageEnv } from "@/lib/env";
import { apiAuthDeps } from "../api-auth-deps";
import type { UsageHttpDeps } from "./http";

/** The real dependencies of GET /api/usage: the shared identity (key or session). */
export function usageHttpDeps(): UsageHttpDeps {
  const { getCreator, keyAuth } = apiAuthDeps();
  return { getCreator, keyAuth, usageSecret: () => parseUsageEnv().USAGE_HASH_SECRET };
}
