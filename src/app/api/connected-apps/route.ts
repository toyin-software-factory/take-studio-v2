import { handleList } from "@/server/oauth/http";
import { connectedAppsDeps } from "@/server/oauth/deps";

export const dynamic = "force-dynamic";

/** The apps the creator connected with sign in (spec 0019 AC-14). Session only. */
export async function GET(request: Request): Promise<Response> {
  return handleList(request, connectedAppsDeps());
}
