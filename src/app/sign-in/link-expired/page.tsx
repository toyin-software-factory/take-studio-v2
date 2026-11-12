import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SkipLink } from "@/components/shell/skip-link";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = { title: "Link expired · Take Studio" };

/** An expired or already used sign in link (spec 0006, AC-2): a friendly page to ask for a new one. */
export default function LinkExpiredPage() {
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
        <h1 className="text-h2">Sign in to Take Studio</h1>
        <SignInForm notice="link_expired" />
      </main>
    </>
  );
}
