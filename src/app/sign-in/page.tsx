import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SkipLink } from "@/components/shell/skip-link";
import { Icon } from "@/components/ui/icon";
import { getSession } from "@/server/request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in · Take Studio" };

/** Sign in (spec 0006, AC-1): Google or an emailed link. Signed in creators go to the library. */
export default async function SignInPage() {
  if (await getSession(await headers())) redirect("/");
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
        className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-sm flex-col justify-center gap-6 px-4 pb-16 outline-hidden"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-h2">Sign in to Take Studio</h1>
          <p className="text-muted-foreground">Use Google, or get a one time link by email.</p>
        </div>
        <SignInForm />
      </main>
    </>
  );
}
