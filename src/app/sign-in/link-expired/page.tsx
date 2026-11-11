import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SkipLink } from "@/components/shell/skip-link";

export const metadata: Metadata = { title: "Link expired · Take Studio" };

/** An expired or already used sign in link (spec 0006, AC-2): a friendly page to ask for a new one. */
export default function LinkExpiredPage() {
  return (
    <>
      <SkipLink />
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 outline-hidden"
      >
        <h1 className="text-h1 font-semibold">Sign in to Take Studio</h1>
        <SignInForm notice="link_expired" />
      </main>
    </>
  );
}
