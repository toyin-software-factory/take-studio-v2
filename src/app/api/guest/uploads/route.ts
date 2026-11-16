import { guestHttpDeps } from "@/server/guest/deps";
import { handleGuestCreate } from "@/server/guest/http";

export const dynamic = "force-dynamic";

/** The drop box: starts an upload for a visitor without an account (spec 0023). */
export function POST(request: Request): Promise<Response> {
  return handleGuestCreate(request, guestHttpDeps());
}
