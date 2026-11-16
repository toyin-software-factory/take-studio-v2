import { and, eq, isNull } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { guestClaim } from "@/db/schema";
import type { Db } from "@/db/types";
import { runTx } from "@/db/tx";
import { guestEmailSchema } from "@/lib/api-schemas/requests";
import { GUEST_EMAIL_SUFFIX, GUEST_MAX_EMAIL_SENDS, claimPath } from "@/lib/guest-rules";
import { type Result, err, ok } from "@/lib/result";
import { usageAccountHash } from "@/lib/usage-hash";
import { guestCookieValue, liveGuest } from "./session";

/**
 * `POST /api/guest/email` (spec 0023 step 4, AC-2): the guest types one address and gets one
 * sign in link through the existing Better Auth magic link. The link's `callbackURL` is
 * `/claim?c=<claim id>`. A guest can ask for at most 5 links (C2); a second address replaces the
 * first. The address, its hash, the link and the claim id never reach a log or an event.
 */

export type SendFailure = "rate_limited" | "send_failed" | "invalid_email";

export type GuestEmailDeps = {
  readonly appOrigin: string;
  readonly getDb: () => Promise<Db>;
  readonly hashSecret: () => string;
  /** Sends the sign in link for `email`; the route never sees the link itself. */
  readonly sendLink: (input: {
    readonly email: string;
    readonly callbackURL: string;
    readonly headers: Headers;
  }) => Promise<Result<true, SendFailure>>;
  readonly now?: () => Date;
};

const MESSAGES = {
  forbidden: "This request isn't allowed.",
  invalid: "Enter a real email address.",
  no_guest: "Your upload isn't here any more. Drop your video again to start over.",
  too_many:
    "You've asked for the most sign in links this upload allows. Sign in with Google instead.",
  rate_limited: "Too many sign in links requested. Try again in a few minutes.",
  send_failed: "We couldn't send the email. Please try again.",
} as const;

const STATUS = {
  forbidden: 403,
  invalid: 422,
  no_guest: 401,
  too_many: 429,
  rate_limited: 429,
  send_failed: 503,
} as const;

function refuse(code: keyof typeof MESSAGES): Response {
  return Response.json(
    { error: code, message: MESSAGES[code] },
    { status: STATUS[code], headers: { "cache-control": "private, no-store" } },
  );
}

/** Better Auth's refusals for a magic link request, as ours. Anything else is `send_failed`. */
export function sendFailureOf(error: unknown): SendFailure {
  const code = error instanceof APIError ? (error.body as { code?: string } | undefined)?.code : "";
  if (code === "EMAIL_RATE_LIMITED") return "rate_limited";
  if (code === "INVALID_EMAIL") return "invalid_email";
  return "send_failed";
}

type Previous = { readonly email: string | null; readonly emailHash: string | null };

/** Takes one of the 5 sends and stores the new address, in one lock. Null when the cap is used. */
async function takeSend(
  db: Db,
  guestUserId: string,
  next: Previous,
): Promise<{ claimId: string; previous: Previous } | null> {
  const taken = await runTx(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(guestClaim)
      .where(and(eq(guestClaim.guestUserId, guestUserId), isNull(guestClaim.claimedAt)))
      .for("update");
    if (!row || row.emailSends >= GUEST_MAX_EMAIL_SENDS) return err("full" as const);
    await tx
      .update(guestClaim)
      .set({ ...next, emailSends: row.emailSends + 1 })
      .where(eq(guestClaim.id, row.id));
    return ok({ claimId: row.id, previous: { email: row.email, emailHash: row.emailHash } });
  });
  return taken.ok ? taken.data : null;
}

/** A send that did not go out gives its slot and the earlier address back. */
async function giveBack(
  db: Db,
  claimId: string,
  previous: Previous,
  reserved: Previous,
): Promise<void> {
  await runTx(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(guestClaim)
      .where(eq(guestClaim.id, claimId))
      .for("update");
    if (row) {
      // Put the earlier address back only while this request's address is still the one stored:
      // a newer send that went out keeps its address. The send slot is refunded either way.
      const own = row.emailHash === reserved.emailHash;
      await tx
        .update(guestClaim)
        .set({ ...(own ? previous : {}), emailSends: Math.max(0, row.emailSends - 1) })
        .where(eq(guestClaim.id, claimId));
    }
    return ok(true as const);
  });
}

export async function handleGuestEmail(request: Request, deps: GuestEmailDeps): Promise<Response> {
  if (request.headers.get("origin") !== deps.appOrigin) return refuse("forbidden");
  const parsed = guestEmailSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success || parsed.data.email.endsWith(GUEST_EMAIL_SUFFIX)) return refuse("invalid");
  const { email } = parsed.data;

  const db = await deps.getDb();
  const now = deps.now?.() ?? new Date();
  const guest = await liveGuest(db, guestCookieValue(request.headers.get("cookie")), now);
  if (!guest) return refuse("no_guest");

  let emailHash: string;
  try {
    emailHash = await usageAccountHash(email, deps.hashSecret());
  } catch {
    return refuse("send_failed");
  }
  const taken = await takeSend(db, guest.creatorId, { email, emailHash });
  if (!taken) return refuse("too_many");

  let sent: Result<true, SendFailure>;
  try {
    sent = await deps.sendLink({
      email,
      callbackURL: claimPath(taken.claimId),
      headers: request.headers,
    });
  } catch (error) {
    sent = err(sendFailureOf(error));
  }
  if (!sent.ok) {
    await giveBack(db, taken.claimId, taken.previous, { email, emailHash });
    return refuse(sent.error === "invalid_email" ? "invalid" : sent.error);
  }
  return Response.json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
}
