import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { ok } from "@/lib/result";
import { runTx } from "../tx";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
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
    // Consent is part of identity: a token pair minted while a disconnect ran (a refresh that
    // read the old row first) has no consent row left and must not work.
    .innerJoin(
      oauthConsent,
      and(
        eq(oauthConsent.userId, oauthAccessToken.userId),
        eq(oauthConsent.clientId, oauthAccessToken.clientId),
      ),
    )
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
  const result = await runTx(db, async (tx) => {
    // Consent first: from here on a token of this grant no longer authenticates, even one a
    // concurrent refresh inserts before the deletes below finish.
    const gone = await tx
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, creatorId), eq(oauthConsent.clientId, clientId)))
      .returning({ id: oauthConsent.id });
    await tx
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, creatorId), eq(oauthAccessToken.clientId, clientId)));
    await tx
      .delete(oauthRefreshToken)
      .where(
        and(eq(oauthRefreshToken.userId, creatorId), eq(oauthRefreshToken.clientId, clientId)),
      );
    // A code the app was given but has not exchanged yet (60 seconds) would still buy new tokens.
    await tx.delete(verification).where(
      sql`case when ${verification.value} like '{"type":"authorization_code"%'
        then ${verification.value}::jsonb ->> 'userId' = ${creatorId}
          and ${verification.value}::jsonb -> 'query' ->> 'client_id' = ${clientId}
        else false end`,
    );
    return ok(gone.length > 0);
  });
  return result.ok ? result.data : false;
}

/**
 * True when this refresh token belongs to a grant whose consent is gone (a disconnect): the
 * refresh must be refused so it cannot mint a new pair. Unknown tokens are left to the plugin.
 */
export async function refreshGrantDisconnected(
  db: Executor,
  refreshHash: string,
  clientId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: oauthRefreshToken.userId })
    .from(oauthRefreshToken)
    .where(and(eq(oauthRefreshToken.token, refreshHash), eq(oauthRefreshToken.clientId, clientId)))
    .limit(1);
  if (!row) return false;
  const [consent] = await db
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.userId, row.userId), eq(oauthConsent.clientId, clientId)))
    .limit(1);
  return consent === undefined;
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

// Split by job (B2-T117): the cleanup sweep and the request count are in `oauth-cleanup`.
// This file keeps the import path stable.
export {
  UNUSED_CLIENT_DAYS,
  countOauthRequest,
  deleteExpiredOauthRows,
  deleteUnusedOauthClients,
} from "./oauth-cleanup";
