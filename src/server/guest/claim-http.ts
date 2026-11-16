import { guestClaimSchema } from "@/lib/api-schemas/requests";
import { claimTarget } from "@/lib/guest-rules";
import { type ClaimDeps, claimGuest } from "./claim";
import { guestCookieValue, guestSetCookie } from "./session";

/**
 * `POST /api/guest/claim` (spec 0023 step 5, C5): the confirm click for a match by email only.
 * Needs a signed in session and the app's Origin. It claims with `confirmed: true`, clears the
 * guest cookie (it is dead once the claim ends) and answers where to go. No logging.
 */

export type ClaimHttpDeps = {
  readonly appOrigin: string;
  readonly secureCookie: boolean;
  readonly signedInUserId: (request: Request) => Promise<string | null>;
  readonly claimDeps: () => Promise<ClaimDeps>;
};

const NO_STORE = { "cache-control": "private, no-store" };

export async function handleGuestClaim(request: Request, deps: ClaimHttpDeps): Promise<Response> {
  if (request.headers.get("origin") !== deps.appOrigin) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const userId = await deps.signedInUserId(request);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const parsed = guestClaimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "invalid" }, { status: 422, headers: NO_STORE });

  const result = await claimGuest(await deps.claimDeps(), {
    claimId: parsed.data.claimId,
    userId,
    cookie: guestCookieValue(request.headers.get("cookie")),
    confirmed: true,
  });
  if (!result.ok)
    return Response.json({ error: "storage_error" }, { status: 503, headers: NO_STORE });
  const outcome = result.data;
  if (outcome.kind !== "done") {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  const headers = new Headers(NO_STORE);
  headers.append("set-cookie", guestSetCookie(null, deps.secureCookie));
  const all = [...outcome.moved, ...outcome.pending];
  return Response.json(
    { ok: true, target: claimTarget(all), waiting: outcome.pending },
    { headers },
  );
}
