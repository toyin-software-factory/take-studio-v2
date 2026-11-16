import { and, eq, gt, isNull } from "drizzle-orm";
import { transitionTake } from "@/db/data/takes";
import { guestClaim, take, user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { runTx } from "@/db/tx";
import { uploadGuestCreateSchema } from "@/lib/api-schemas/requests";
import { hashGuestToken, newGuestToken } from "@/lib/guest-hash";
import { GUEST_MAX_BYTES, GUEST_TTL_HOURS, guestEmail } from "@/lib/guest-rules";
import { type Result, err, ok } from "@/lib/result";
import { UPLOAD, containerContentType, partCount } from "@/lib/uploads";
import { attachUpload, create } from "../takes";
import type { CreatedUpload, UploadDeps } from "../uploads/base";

export type GuestCreateError = "invalid" | "too_large" | "storage_error";

export type GuestCreated = CreatedUpload & {
  /** The cookie value to set: the guest's existing token, or a new one. */
  readonly token: string;
};

/**
 * `POST /api/guest/uploads`, after the route's checks (Origin, body, Turnstile). One transaction
 * finds the guest the cookie points at (or makes a new guest user and claim), pushes its expiry to
 * 24 hours after this drop, and creates the take marked `guest_origin`; then the multipart upload
 * starts. The kill switch, the busy check, the address count and the daily minutes are step 3.
 */
export async function createGuestUpload(
  deps: UploadDeps,
  input: { readonly body: unknown; readonly cookie: string | null; readonly ipHash: string },
): Promise<Result<GuestCreated, GuestCreateError>> {
  const parsed = uploadGuestCreateSchema.safeParse(input.body);
  if (!parsed.success) return err("invalid");
  const { fileName, sizeBytes, container } = parsed.data;
  if (sizeBytes > GUEST_MAX_BYTES) return err("too_large");
  const now = deps.now?.() ?? new Date();
  const expiresAt = new Date(now.getTime() + GUEST_TTL_HOURS * 3_600_000);

  const made = await runTx(deps.db, async (tx) => {
    const existing = input.cookie ? await findLive(tx, input.cookie, now) : null;
    let guestId = existing;
    let token = input.cookie ?? "";
    if (guestId) {
      await tx.select({ id: user.id }).from(user).where(eq(user.id, guestId)).for("update");
      await tx.update(guestClaim).set({ expiresAt }).where(eq(guestClaim.guestUserId, guestId));
    } else {
      guestId = crypto.randomUUID();
      token = newGuestToken();
      await tx.insert(user).values({
        id: guestId,
        name: "Guest",
        email: guestEmail(guestId),
        emailVerified: false,
        takeEmails: false,
        guest: true,
      });
      await tx.insert(guestClaim).values({
        guestUserId: guestId,
        tokenHash: await hashGuestToken(token),
        ipHash: input.ipHash,
        expiresAt,
      });
    }
    const t = await create(tx, { creatorId: guestId, fileName, container, bytes: sizeBytes });
    if (!t.ok) return err("invalid" as const);
    await tx.update(take).set({ guestOrigin: true }).where(eq(take.id, t.data.id));
    return ok({ take: t.data, token });
  });
  if (!made.ok) return made;
  const { take: t, token } = made.data;

  let uploadId: string;
  try {
    uploadId = await deps.r2.createMultipartUpload(t.originalKey, containerContentType(container));
  } catch {
    await transitionTake(deps.db, t.id, "uploading", "failed", { failureCode: "internal_error" });
    return err("storage_error");
  }
  const attached = await attachUpload(deps.db, t.creatorId, t.id, uploadId);
  if (!attached.ok) return err("storage_error");
  return ok({ takeId: t.id, partSize: UPLOAD.partSize, partCount: partCount(sizeBytes), token });
}

async function findLive(db: Executor, cookie: string, now: Date): Promise<string | null> {
  const [row] = await db
    .select({ id: guestClaim.guestUserId })
    .from(guestClaim)
    .where(
      and(
        eq(guestClaim.tokenHash, await hashGuestToken(cookie)),
        gt(guestClaim.expiresAt, now),
        isNull(guestClaim.claimedAt),
      ),
    );
  return row?.id ?? null;
}
