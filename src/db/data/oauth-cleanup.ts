import { and, lt, or, sql } from "drizzle-orm";
import { API_RATE, rateWindowStart } from "@/lib/api-rules";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRateWindow,
  oauthRefreshToken,
} from "../schema";
import type { Executor } from "../types";

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

/** An OAuth client with no consent and no token for this long is an unused registration. */
export const UNUSED_CLIENT_DAYS = 30;

/**
 * Deletes registered OAuth clients that were never used: older than `UNUSED_CLIENT_DAYS`, with no
 * consent row and no access or refresh token (B2-T104, security review item 2). Registration is
 * open, so unused rows only grow. A client created at or after the cutoff, or with a null
 * `created_at`, is kept; so is any client a creator ever consented to and still holds a grant.
 * The resource link rows go with it (cascade). Returns the number deleted.
 */
export async function deleteUnusedOauthClients(
  db: Executor,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - UNUSED_CLIENT_DAYS * 24 * 60 * 60 * 1000);
  const removed = await db
    .delete(oauthClient)
    .where(
      and(
        lt(oauthClient.createdAt, cutoff),
        sql`not exists (select 1 from ${oauthConsent} where ${oauthConsent.clientId} = ${oauthClient.clientId})`,
        sql`not exists (select 1 from ${oauthAccessToken} where ${oauthAccessToken.clientId} = ${oauthClient.clientId})`,
        sql`not exists (select 1 from ${oauthRefreshToken} where ${oauthRefreshToken.clientId} = ${oauthClient.clientId})`,
      ),
    )
    .returning({ id: oauthClient.id });
  return removed.length;
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
