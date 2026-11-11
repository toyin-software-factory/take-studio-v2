"use client";

import { captureException } from "@sentry/core";
import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert } from "lucide-react";
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
    captureException(error);
  }, [error]);

  return (
    <>
      <SkipLink />
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex min-h-dvh max-w-content flex-col items-start justify-center gap-4 px-4 outline-hidden md:px-6"
      >
        <Icon icon={CircleAlert} size="empty" className="text-danger" />
        <h1 className="text-h1 font-semibold">Something went wrong</h1>
        <p className="text-text-muted">
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
