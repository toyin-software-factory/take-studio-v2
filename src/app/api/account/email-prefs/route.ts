import { handleGetPrefs, handleSetPrefs } from "@/server/email/prefs-http";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

/** Whether take emails are on (spec 0006, AC-6). */
export async function GET(request: Request): Promise<Response> {
  return handleGetPrefs(request, takeHttpDeps());
}

/** Turn take emails on or off from the take page switch. */
export async function PATCH(request: Request): Promise<Response> {
  return handleSetPrefs(request, takeHttpDeps());
}
