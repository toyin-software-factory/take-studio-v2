import { eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { guestClaim, take, user } from "@/db/schema";
import { createCreator, seedTake } from "@/db/testing/test-db";
import { hashGuestToken } from "@/lib/guest-hash";
import { guestEmail } from "@/lib/guest-rules";

/** A guest with a claim row and takes in the given statuses (synthetic data only). */
export async function seedGuest(
  db: Db,
  options: {
    readonly statuses?: readonly ("uploaded" | "uploading" | "ready")[];
    readonly typedEmail?: string | null;
  } = {},
) {
  const id = `guest-${crypto.randomUUID()}`;
  const token = `tok-${crypto.randomUUID()}`;
  await db.insert(user).values({
    id,
    name: "Guest",
    email: guestEmail(id),
    emailVerified: false,
    takeEmails: false,
    guest: true,
  });
  const [claim] = await db
    .insert(guestClaim)
    .values({
      guestUserId: id,
      tokenHash: await hashGuestToken(token),
      email: options.typedEmail ?? null,
      ipHash: "iphash",
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  const takes = [];
  for (const status of options.statuses ?? ["uploaded"]) {
    takes.push(await seedTake(db, id, { status, guestOrigin: true }));
  }
  if (!claim) throw new Error("no claim");
  return { guestId: id, token, claimId: claim.id, takes };
}

/** A signed in account with a chosen email and verified flag. */
export async function seedAccount(db: Db, email: string, verified = true) {
  const creator = await createCreator(db, email);
  await db.update(user).set({ emailVerified: verified }).where(eq(user.id, creator.id));
  return creator;
}

export const takesOf = async (db: Db, creatorId: string) =>
  db.select().from(take).where(eq(take.creatorId, creatorId));

export const guestExists = async (db: Db, guestId: string) =>
  (await db.select().from(user).where(eq(user.id, guestId))).length === 1;
