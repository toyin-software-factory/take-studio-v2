"use client";

import { reportBrowserError } from "@/lib/browser-errors";
import { startTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Clapperboard } from "lucide-react";
import { SkipLink } from "@/components/shell/skip-link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/**
 * App level error page (design.md Screen states, Error): says what happened and offers Retry,
 * never a raw error. Reports to Sentry by ID only (spec 0005). Retry refetches the page's
 * server data, then resets the boundary.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    reportBrowserError(error);
  }, [error]);

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
        <Icon icon={CircleAlert} size="empty" className="text-danger" />
        <h1 className="text-h2">Something went wrong</h1>
        <p className="text-muted-foreground">
          We couldn&rsquo;t load this page. We&rsquo;ve been told about it. Try again in a moment.
        </p>
        <Button
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          Retry
        </Button>
      </main>
    </>
  );
}
