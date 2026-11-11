import { handleList } from "@/server/takes/http";
import { takeHttpDeps } from "@/server/takes/deps";

export const dynamic = "force-dynamic";

/** The creator's takes, newest first, 24 per page (spec 0004, AC-1). */
export async function GET(request: Request): Promise<Response> {
  return handleList(request, takeHttpDeps());
}
