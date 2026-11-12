import { backgroundHttpDeps } from "@/server/backgrounds/deps";
import { handleListBackgrounds } from "@/server/backgrounds/http";

export const dynamic = "force-dynamic";

/** The built in studios and the creator's own backgrounds, for the picker (spec 0008, AC-1). */
export function GET(request: Request): Promise<Response> {
  return handleListBackgrounds(request, backgroundHttpDeps());
}
