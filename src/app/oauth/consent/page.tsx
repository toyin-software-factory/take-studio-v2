import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { ConsentForm } from "@/components/oauth/consent-form";
import { SkipLink } from "@/components/shell/skip-link";
import { Icon } from "@/components/ui/icon";
import { CONSENT_COPY, clientLabel, redirectHosts } from "@/lib/oauth-screen";
import { consentClientFor } from "@/server/oauth/consent-client";
import { getDb, getSession } from "@/server/request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Allow an app · Take Studio",
  robots: { index: false, follow: false },
};

/**
 * The page an assistant sends a creator to (spec 0019 AC-14, AC-15): which app, what it can do,
 * Allow and Deny. Better Auth adds the signed `oauth_query` to this address; the form sends it
 * back untouched. Signed out goes to sign in. The app's name is plain text, never a link.
 */
export default async function ConsentPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly client_id?: string | string[] }>;
}) {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in");
  const raw = (await searchParams).client_id;
  const clientId = typeof raw === "string" ? raw : "";
  const client = clientId === "" ? null : await consentClientFor(await getDb(), clientId);
  return (
    <>
      <SkipLink />
      <header className="mx-auto flex w-full max-w-content items-center px-[clamp(16px,2.4vw,32px)] py-5">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md px-1 py-1 text-h4 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11"
        >
          <Icon icon={Clapperboard} />
          Take Studio
        </Link>
      </header>
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-md flex-col justify-center gap-6 px-4 pb-16 outline-hidden"
      >
        {client ? (
          <ConsentForm
            appName={clientLabel(client.name)}
            hosts={redirectHosts(client.redirectUris)}
            email={session.user.email}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <h1 className="text-h2">{CONSENT_COPY.unknownAppTitle}</h1>
            <p className="text-ink">{CONSENT_COPY.unknownApp}</p>
          </div>
        )}
      </main>
    </>
  );
}
