import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../schema";
import type { Executor } from "../types";

/**
 * The creator behind an OAuth access token hash (spec 0019 AC-13, AC-14), or null. The token
 * must be unrevoked, unexpired and issued for `resource` (the /mcp resource), and its client must
 * not be disabled. Looked up by the hash alone: the raw token never reaches this layer.
 */
export async function authenticateOauthToken(
  db: Executor,
  tokenHash: string,
  resource: string,
  now: Date = new Date(),
): Promise<{ readonly creatorId: string } | null> {
  const [row] = await db
    .select({ userId: oauthAccessToken.userId })
    .from(oauthAccessToken)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
    .where(
      and(
        eq(oauthAccessToken.token, tokenHash),
        isNull(oauthAccessToken.revoked),
        gt(oauthAccessToken.expiresAt, now),
        sql`${resource}::text = any(${oauthAccessToken.resources})`,
        or(isNull(oauthClient.disabled), eq(oauthClient.disabled, false)),
      ),
    )
    .limit(1);
  return row?.userId ? { creatorId: row.userId } : null;
}

/** An assistant a creator connected (AC-14): the client name, when it was allowed, last use. */
export type ConnectedApp = {
  /** The consent row's ID: safe to show, never a token or a client secret. */
  readonly id: string;
  readonly clientId: string;
  readonly name: string | null;
  readonly connectedAt: Date;
  readonly lastUsedAt: Date | null;
};

/** The creator's connected assistants, newest first. Never a token or a client secret. */
export async function listConnectedApps(
  db: Executor,
  creatorId: string,
): Promise<readonly ConnectedApp[]> {
  const rows = await db
    .select({
      id: oauthConsent.id,
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      connectedAt: oauthConsent.createdAt,
      lastUsedAt: sql<Date | null>`(
        select max(${oauthAccessToken.createdAt}) from ${oauthAccessToken}
        where ${oauthAccessToken.clientId} = ${oauthConsent.clientId}
          and ${oauthAccessToken.userId} = ${oauthConsent.userId}
      )`,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, creatorId))
    .orderBy(desc(oauthConsent.createdAt));
  return rows;
}

/**
 * Disconnect (AC-14): deletes the creator's grant for one client and every access and refresh
 * token it holds for that creator. The next request with such a token is refused. Returns
 * whether a grant existed. Another creator's grant of the same client is untouched.
 */
export async function disconnectApp(
  db: Executor,
  creatorId: string,
  clientId: string,
): Promise<boolean> {
  await db
    .delete(oauthAccessToken)
    .where(and(eq(oauthAccessToken.userId, creatorId), eq(oauthAccessToken.clientId, clientId)));
  await db
    .delete(oauthRefreshToken)
    .where(and(eq(oauthRefreshToken.userId, creatorId), eq(oauthRefreshToken.clientId, clientId)));
  const gone = await db
    .delete(oauthConsent)
    .where(and(eq(oauthConsent.userId, creatorId), eq(oauthConsent.clientId, clientId)))
    .returning({ id: oauthConsent.id });
  return gone.length > 0;
}

/**
 * Cleanup sweep: deletes access and refresh tokens that expired or were revoked more than a day
 * ago (the day keeps a reused refresh token detectable). Returns the counts.
 */
export async function deleteExpiredOauthRows(
  db: Executor,
  now: Date = new Date(),
): Promise<{ readonly accessTokens: number; readonly refreshTokens: number }> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const access = await db
    .delete(oauthAccessToken)
    .where(or(lt(oauthAccessToken.expiresAt, cutoff), lt(oauthAccessToken.revoked, cutoff)))
    .returning({ id: oauthAccessToken.id });
  const refresh = await db
    .delete(oauthRefreshToken)
    .where(or(lt(oauthRefreshToken.expiresAt, cutoff), lt(oauthRefreshToken.revoked, cutoff)))
    .returning({ id: oauthRefreshToken.id });
  return { accessTokens: access.length, refreshTokens: refresh.length };
}

/** Disconnects by consent row ID; false when it is not this creator's (or already gone). */
export async function disconnectConsent(
  db: Executor,
  creatorId: string,
  consentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ clientId: oauthConsent.clientId })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.id, consentId), eq(oauthConsent.userId, creatorId)))
    .limit(1);
  return row ? disconnectApp(db, creatorId, row.clientId) : false;
}

export type ConsentClient = {
  readonly name: string | null;
  readonly redirectUris: readonly string[];
};

/** What the consent page shows about a client: its name and where it will send the creator. */
export async function getConsentClient(
  db: Executor,
  clientId: string,
): Promise<ConsentClient | null> {
  const [row] = await db
    .select({ name: oauthClient.name, redirectUris: oauthClient.redirectUris })
    .from(oauthClient)
    .where(and(eq(oauthClient.clientId, clientId), eq(oauthClient.disabled, false)))
    .limit(1);
  return row ? { name: row.name, redirectUris: row.redirectUris ?? [] } : null;
}
