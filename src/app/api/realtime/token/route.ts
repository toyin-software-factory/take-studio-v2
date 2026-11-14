import { realtimeHttpDeps } from "@/server/realtime/deps";
import { handleToken } from "@/server/realtime/http";

export const dynamic = "force-dynamic";

/** A short lived Deepgram token for voice following (spec 0021 AC-12). Session only. */
export function POST(request: Request): Promise<Response> {
  return handleToken(request, realtimeHttpDeps());
}
