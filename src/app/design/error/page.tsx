import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isGalleryEnabled } from "../gallery";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Error page check · Take Studio",
  robots: { index: false, follow: false },
};

/** The cookie a test sets so the next render succeeds, which shows Retry recovering. */
const ERROR_CHECK_COOKIE = "error-check-ok";

/**
 * Test only: throws while rendering, so the app error page (`src/app/error.tsx`) can be checked
 * in a browser (B2-T99). Gated like the /design gallery: not found unless NODE_ENV is development
 * or the Worker variable DESIGN_GALLERY is `1`, so production answers 404 and never throws.
 */
export default async function ErrorCheckPage() {
  if (
    !isGalleryEnabled({
      NODE_ENV: process.env.NODE_ENV,
      DESIGN_GALLERY: process.env.DESIGN_GALLERY,
    })
  ) {
    notFound();
  }
  const recovered = (await cookies()).get(ERROR_CHECK_COOKIE)?.value === "1";
  if (!recovered) throw new Error("error page check: a render failure on purpose");
  return (
    <main id="content" className="mx-auto max-w-content px-4 py-8">
      <h1 className="text-h2">Recovered</h1>
    </main>
  );
}
