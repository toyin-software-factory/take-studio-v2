import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { API_RATE, rateWindowStart } from "@/lib/api-rules";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRateWindow,
  oauthRefreshToken,
  verification,
} from "../schema";
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
): Promise<{ readonly creatorId: string; readonly clientId: string } | null> {
  const [row] = await db
    .select({ userId: oauthAccessToken.userId, clientId: oauthAccessToken.clientId })
    .from(oauthAccessToken)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
    .where(
      and(
        eq(oauthAccessToken.token, tokenHash),
        isNull(oauthAccessToken.revoked),
        gt(oauthAccessToken.expiresAt, now),
        // A sender bound (DPoP) token needs a proof of the key, which this bearer only path
        // never checks: it is refused here, so a copied token cannot be used without its key.
        or(
          isNull(oauthAccessToken.confirmation),
          sql`${oauthAccessToken.confirmation} = 'null'::jsonb`,
        ),
        sql`${resource}::text = any(${oauthAccessToken.resources})`,
        or(isNull(oauthClient.disabled), eq(oauthClient.disabled, false)),
      ),
    )
    .limit(1);
  return row?.userId ? { creatorId: row.userId, clientId: row.clientId } : null;
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
  // A code the app was given but has not exchanged yet (60 seconds) would still buy new tokens.
  await db.delete(verification).where(
    sql`case when ${verification.value} like '{"type":"authorization_code"%'
      then ${verification.value}::jsonb ->> 'userId' = ${creatorId}
        and ${verification.value}::jsonb -> 'query' ->> 'client_id' = ${clientId}
      else false end`,
  );
  const gone = await db
    .delete(oauthConsent)
    .where(and(eq(oauthConsent.userId, creatorId), eq(oauthConsent.clientId, clientId)))
    .returning({ id: oauthConsent.id });
  return gone.length > 0;
}

/**
 * A refresh token that was already rotated and is presented again was stolen or copied: the whole
 * grant goes, consent included, so the app must ask the creator again (AC-13). Better Auth's own
 * reuse handling deletes the tokens but leaves the consent row, which would let the next
 * authorize skip the consent page. Looked up by the hash and client; returns whether it was a
 * reuse. Nothing here sees the raw token.
 */
export async function revokeGrantOnRefreshReuse(
  db: Executor,
  refreshHash: string,
  clientId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: oauthRefreshToken.userId })
    .from(oauthRefreshToken)
    .where(
      and(
        eq(oauthRefreshToken.token, refreshHash),
        eq(oauthRefreshToken.clientId, clientId),
        sql`${oauthRefreshToken.revoked} is not null`,
      ),
    )
    .limit(1);
  if (!row) return false;
  await disconnectApp(db, row.userId, clientId);
  return true;
}

/**
 * Cleanup sweep: deletes access tokens that expired or were revoked more than a day ago, and
 * refresh tokens that expired more than a day ago (a revoked one is kept until then, so a reused
 * one is still detected). Returns the counts.
 */
export async function deleteExpiredOauthRows(
  db: Executor,
  now: Date = new Date(),
): Promise<{
  readonly accessTokens: number;
  readonly refreshTokens: number;
  readonly rateWindows: number;
}> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const access = await db
    .delete(oauthAccessToken)
    .where(or(lt(oauthAccessToken.expiresAt, cutoff), lt(oauthAccessToken.revoked, cutoff)))
    .returning({ id: oauthAccessToken.id });
  // A rotated (revoked) refresh token stays until it expires: presenting it again is how a copy
  // is detected and the grant revoked, so a revoked row is never purged early.
  const refresh = await db
    .delete(oauthRefreshToken)
    .where(lt(oauthRefreshToken.expiresAt, cutoff))
    .returning({ id: oauthRefreshToken.id });
  const windows = await db
    .delete(oauthRateWindow)
    .where(lt(oauthRateWindow.windowStart, new Date(now.getTime() - API_RATE.keepMs)))
    .returning({ clientId: oauthRateWindow.clientId });
  return {
    accessTokens: access.length,
    refreshTokens: refresh.length,
    rateWindows: windows.length,
  };
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

/**
 * Counts one request for a connected app of a creator in the current minute (spec 0019 AC-14),
 * one atomic upsert like `countApiRequest`. `at` is for tests; left out, the window and the
 * second come from the database clock.
 */
export async function countOauthRequest(
  db: Executor,
  clientId: string,
  userId: string,
  at?: Date,
): Promise<{ readonly count: number; readonly secondsIntoMinute: number }> {
  const windowStart = at
    ? rateWindowStart(at)
    : sql<Date>`date_trunc('minute', now() at time zone 'utc') at time zone 'utc'`;
  const [row] = await db
    .insert(oauthRateWindow)
    .values({ clientId, userId, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [oauthRateWindow.clientId, oauthRateWindow.userId, oauthRateWindow.windowStart],
      set: { count: sql`${oauthRateWindow.count} + 1` },
    })
    .returning({
      count: oauthRateWindow.count,
      secondsIntoMinute: at
        ? sql<number>`${at.getUTCSeconds()}::int`
        : sql<number>`floor(extract(second from now()))::int`,
    });
  return row ?? { count: 1, secondsIntoMinute: 0 };
}
