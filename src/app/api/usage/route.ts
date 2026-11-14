import { handleUsage } from "@/server/usage/http";
import { usageHttpDeps } from "@/server/usage/deps";

export const dynamic = "force-dynamic";

/** The creator's monthly usage (spec 0014 AC-8). */
export function GET(request: Request): Promise<Response> {
  return handleUsage(request, usageHttpDeps());
}
