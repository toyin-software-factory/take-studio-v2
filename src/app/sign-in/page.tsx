import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SkipLink } from "@/components/shell/skip-link";
import { getSession } from "@/server/request";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in · Take Studio" };

/** Sign in (spec 0006, AC-1): Google or an emailed link. Signed in creators go to the library. */
export default async function SignInPage() {
  if (await getSession(await headers())) redirect("/");
  return (
    <>
      <SkipLink />
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 outline-hidden"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold">Sign in to Take Studio</h1>
          <p className="text-text-muted">Use Google, or get a one time link by email.</p>
        </div>
        <SignInForm />
      </main>
    </>
  );
}
