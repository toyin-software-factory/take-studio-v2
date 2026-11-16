import Link from "next/link";
import { Clapperboard } from "lucide-react";
import type { ReactNode } from "react";
import { SkipLink } from "@/components/shell/skip-link";
import { Icon } from "@/components/ui/icon";

/** The standalone page layout (same as sign in) for the /claim states. */
export function ClaimShell({ children }: { readonly children: ReactNode }) {
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
        {children}
      </main>
    </>
  );
}
