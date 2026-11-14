import { type ApiAuthDeps, guard as authGuard } from "../api-auth";
import { disconnectConsent, listConnectedApps } from "@/db/data/oauth";

/**
 * Connected apps routes (spec 0019 AC-14). Session only: any request with an `Authorization`
 * header is 401 `session_required`, so an app's own token can never list or remove apps. Order:
 * Origin (the delete), bearer, session, then the work. Nothing here logs and no token or secret is
 * ever returned; `id` is the consent row's ID.
 */
export type ConnectedAppsDeps = Pick<ApiAuthDeps, "getCreator" | "allowedOrigin">;

const PRIVATE_NO_STORE = { "cache-control": "private, no-store" } as const;

/** GET /api/connected-apps: `{ apps: [{ id, name, connectedAt, lastUsedAt }] }`, newest first. */
export async function handleList(request: Request, deps: ConnectedAppsDeps): Promise<Response> {
  const creator = await authGuard(request, deps, { checkOrigin: false, sessionOnly: true });
  if (creator instanceof Response) return creator;
  const rows = await listConnectedApps(creator.db, creator.creatorId);
  const apps = rows.map(({ id, name, connectedAt, lastUsedAt }) => ({
    id,
    name: name ?? "An app",
    connectedAt,
    lastUsedAt,
  }));
  return Response.json({ apps }, { headers: PRIVATE_NO_STORE });
}

/** DELETE /api/connected-apps/{id}: 204; another creator's, an unknown ID or a repeat is 404. */
export async function handleDisconnect(
  request: Request,
  consentId: string,
  deps: ConnectedAppsDeps,
): Promise<Response> {
  const creator = await authGuard(request, deps, { checkOrigin: true, sessionOnly: true });
  if (creator instanceof Response) return creator;
  const gone = await disconnectConsent(creator.db, creator.creatorId, consentId);
  if (!gone) {
    return Response.json(
      { error: "not_found", message: "We couldn't find that app." },
      { status: 404, headers: PRIVATE_NO_STORE },
    );
  }
  return new Response(null, { status: 204, headers: PRIVATE_NO_STORE });
}
