import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { SkipLink } from "@/components/shell/skip-link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = { title: "Not found · Take Studio" };

/**
 * The styled not found page (AC-11, design.md Screen states): the same page for a missing
 * take, another creator's take and a malformed ID, so none of them reveals anything.
 */
export default function NotFound() {
  return (
    <>
      <SkipLink />
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex min-h-dvh max-w-content flex-col items-start justify-center gap-4 px-4 outline-hidden md:px-6"
      >
        <Icon icon={SearchX} size="empty" className="text-text-muted" />
        <h1 className="text-h1 font-semibold">We couldn&rsquo;t find that page</h1>
        <p className="text-text-muted">
          The take may have been deleted, or the link is wrong. Your takes are in your library.
        </p>
        <Button asChild>
          <Link href="/">Go to your takes</Link>
        </Button>
      </main>
    </>
  );
}
