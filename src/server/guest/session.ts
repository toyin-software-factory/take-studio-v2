import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { guestClaim, take, user } from "@/db/schema";
import type { Db } from "@/db/types";
import { GUEST_COOKIE, GUEST_TTL_HOURS } from "@/lib/guest-rules";
import { hashGuestToken } from "@/lib/guest-hash";

/**
 * The guest cookie (spec 0023). Only routes that opt in read it; every other route never calls
 * this, so a guest cookie is just a stray cookie there (G6).
 */

export type GuestCreator = { readonly db: Db; readonly creatorId: string; readonly guest: true };

/** The cookie value from a Cookie header, or null. */
export function guestCookieValue(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === GUEST_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/** `Set-Cookie` value for a new guest token (or a clearing one when `token` is null). */
export function guestSetCookie(token: string | null, secure: boolean): string {
  const base = `${GUEST_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax`;
  const age = token === null ? 0 : GUEST_TTL_HOURS * 3600;
  return `${base}; Max-Age=${age}${secure ? "; Secure" : ""}`;
}

/**
 * The live guest for a cookie value: its claim is not expired and not claimed. A dead, claimed or
 * unknown cookie is the same as no cookie. With `takeId`, the guest must also own that take.
 */
export async function liveGuest(
  db: Db,
  cookie: string | null,
  now: Date,
  takeId?: string,
): Promise<GuestCreator | null> {
  if (!cookie) return null;
  if (takeId !== undefined && !z.uuid().safeParse(takeId).success) return null;
  const [row] = await db
    .select({ guestUserId: guestClaim.guestUserId })
    .from(guestClaim)
    .innerJoin(user, eq(user.id, guestClaim.guestUserId))
    .where(
      and(
        eq(guestClaim.tokenHash, await hashGuestToken(cookie)),
        gt(guestClaim.expiresAt, now),
        isNull(guestClaim.claimedAt),
        eq(user.guest, true),
      ),
    );
  if (!row) return null;
  if (takeId !== undefined) {
    const [owned] = await db
      .select({ id: take.id })
      .from(take)
      .where(and(eq(take.id, takeId), eq(take.creatorId, row.guestUserId)));
    if (!owned) return null;
  }
  return { db, creatorId: row.guestUserId, guest: true };
}
