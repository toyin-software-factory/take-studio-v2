import { guestEmailDeps } from "@/server/guest/email-deps";
import { handleGuestEmail } from "@/server/guest/email";

export const dynamic = "force-dynamic";

/** Sends the one sign in link for a guest drop (spec 0023, AC-2). */
export function POST(request: Request): Promise<Response> {
  return handleGuestEmail(request, guestEmailDeps());
}
