import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClaimConfirm } from "@/components/claim/claim-confirm";
import { ClaimShell } from "@/components/claim/claim-shell";
import { ClaimWaiting } from "@/components/claim/claim-waiting";
import { buttonVariants } from "@/components/ui/button";
import { claimPath, claimTarget } from "@/lib/guest-rules";
import { claimGuest } from "@/server/guest/claim";
import { realClaimDeps } from "@/server/guest/claim-deps";
import { guestCookieValue } from "@/server/guest/session";
import { getSession } from "@/server/request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add your video · Take Studio",
  robots: { index: false, follow: false },
};

const NONE_COPY = "We couldn't find an upload to add. It may already be in your library.";

/**
 * `/claim?c=<claim id>` (spec 0023 step 5): where the sign in link lands. Signed out goes to sign
 * in and back. A cookie match moves the takes at once; an email only match asks first (C5); a
 * stranger or an old link gets one calm message that tells nothing about whether an upload exists.
 */
export default async function ClaimPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { c } = await searchParams;
  const claimId = typeof c === "string" ? c : "";
  const requestHeaders = await headers();
  const session = await getSession(requestHeaders);
  if (!session) redirect(`/sign-in?return=${encodeURIComponent(claimPath(claimId))}`);

  const result = await claimGuest(await realClaimDeps(), {
    claimId,
    userId: session.user.id,
    cookie: guestCookieValue(requestHeaders.get("cookie")),
    confirmed: false,
  });
  if (!result.ok) throw new Error("claim failed");
  const outcome = result.data;
  if (outcome.kind === "done") {
    const [waiting] = outcome.pending;
    if (waiting) {
      return (
        <ClaimShell>
          <ClaimWaiting
            pendingId={waiting}
            takeIds={[...outcome.moved, ...outcome.pending]}
            claimId={claimId}
          />
        </ClaimShell>
      );
    }
    redirect(claimTarget(outcome.moved));
  }
  return (
    <ClaimShell>
      {outcome.kind === "confirm" ? (
        <ClaimConfirm claimId={claimId} />
      ) : (
        <>
          <h1 className="text-h2">{NONE_COPY}</h1>
          <Link href="/library" className={buttonVariants({ className: "self-start" })}>
            Go to your library
          </Link>
        </>
      )}
    </ClaimShell>
  );
}
