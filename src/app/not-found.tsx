import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard, SearchX } from "lucide-react";
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
        className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-content flex-col items-start justify-center gap-4 px-[clamp(16px,2.4vw,32px)] pb-16 outline-hidden"
      >
        <Icon icon={SearchX} size="empty" className="text-muted-foreground" />
        <h1 className="text-h2">We couldn&rsquo;t find that page</h1>
        <p className="text-muted-foreground">
          The take may have been deleted, or the link is wrong. Your takes are in your library.
        </p>
        <Button asChild>
          <Link href="/library">Go to your takes</Link>
        </Button>
      </main>
    </>
  );
}
