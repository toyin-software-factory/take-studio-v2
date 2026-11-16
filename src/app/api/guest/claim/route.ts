import { guestClaimHttpDeps } from "@/server/guest/claim-deps";
import { handleGuestClaim } from "@/server/guest/claim-http";

export const dynamic = "force-dynamic";

/** The confirm click for an email only match (spec 0023, C5). */
export function POST(request: Request): Promise<Response> {
  return handleGuestClaim(request, guestClaimHttpDeps());
}
