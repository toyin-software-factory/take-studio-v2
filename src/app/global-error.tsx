"use client";

import { captureException } from "@sentry/core";
import { useEffect } from "react";
import { CircleAlert } from "lucide-react";
import { interTight } from "@/lib/fonts";
import "./globals.css";

/**
 * Last resort error page when the root layout itself fails. Reports the error to Sentry
 * (spec 0005, AC-2) and shows a friendly message with Retry, never the raw error (design.md).
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // The light core API reports through the browser client (instrumentation-client.ts).
    captureException(error);
  }, [error]);

  return (
    <html lang="en" className={interTight.variable}>
      <body>
        <main
          id="content"
          className="mx-auto flex min-h-dvh max-w-content flex-col items-start justify-center gap-4 px-4 md:px-6"
        >
          <CircleAlert size={40} strokeWidth={1.5} aria-hidden="true" className="text-danger" />
          <h1 className="text-h1 font-medium">Something went wrong</h1>
          <p className="text-muted-foreground">
            We couldn&rsquo;t load this page. We&rsquo;ve been told about it. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-10 cursor-pointer items-center rounded-md bg-primary px-4 text-small font-medium text-primary-fg hover:bg-primary-hover active:bg-primary-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            Retry
          </button>
        </main>
      </body>
    </html>
  );
}
