import { handleGuestTake } from "@/server/guest/take";
import { guestTakeDeps } from "@/server/guest/take-deps";

export const dynamic = "force-dynamic";

/** The view only result of a guest's own take: status and a short lived play link (spec 0023, AC-10). */
export function GET(request: Request): Promise<Response> {
  return handleGuestTake(request, guestTakeDeps());
}
