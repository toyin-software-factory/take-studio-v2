"use client";

import { captureException } from "@sentry/core";
import { useEffect } from "react";
import { CircleAlert, Clapperboard } from "lucide-react";
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
        <header className="mx-auto flex w-full max-w-content items-center px-[clamp(16px,2.4vw,32px)] py-5">
          {/* A plain link: this page stands alone, so it must not depend on the router. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load is the point here */}
          <a
            href="/"
            className="flex items-center gap-2 rounded-md px-1 py-1 text-h4 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            <Clapperboard size={20} strokeWidth={1.5} aria-hidden="true" />
            Take Studio
          </a>
        </header>
        <main
          id="content"
          className="mx-auto flex min-h-[calc(100dvh-6rem)] max-w-content flex-col items-start justify-center gap-4 px-[clamp(16px,2.4vw,32px)] pb-16"
        >
          <CircleAlert size={40} strokeWidth={1.5} aria-hidden="true" className="text-danger" />
          <h1 className="text-h2">Something went wrong</h1>
          <p className="text-muted-foreground">
            We couldn&rsquo;t load this page. We&rsquo;ve been told about it. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-10 cursor-pointer items-center rounded-full bg-primary px-6 text-body font-medium text-primary-fg transition-[background-color,transform] duration-300 ease-ui hover:bg-primary-hover active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            Retry
          </button>
        </main>
      </body>
    </html>
  );
}
