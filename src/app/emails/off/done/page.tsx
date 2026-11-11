import type { Metadata } from "next";
import Link from "next/link";
import { SkipLink } from "@/components/shell/skip-link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Take emails · Take Studio" };

type Props = { readonly searchParams: Promise<{ readonly status?: string }> };

/** Result of the turn off link (spec 0006, AC-6). Turn them back on from any take page. */
export default async function EmailsOffDonePage({ searchParams }: Props) {
  const off = (await searchParams).status === "off";
  return (
    <>
      <SkipLink />
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 outline-hidden"
      >
        <h1 className="text-h1 font-semibold">
          {off ? "Take emails are off" : "That link didn't work"}
        </h1>
        <p>
          {off
            ? "We won't email you when your takes are ready. You can turn them back on from any take page."
            : "The link is not valid. You can change this setting from any take page once you are signed in."}
        </p>
        <Link href="/" className="underline">
          Go to Take Studio
        </Link>
      </main>
    </>
  );
}
