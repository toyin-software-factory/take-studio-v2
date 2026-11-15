import type { Metadata } from "next";
import { headers } from "next/headers";
import { shouldThrowRootError } from "@/lib/root-error-check";
import { isGalleryEnabled } from "./design/gallery";
import { interTight } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Take Studio",
  description:
    "Upload a video take and get it back trimmed, with a studio background and a transcript.",
};

/**
 * Root HTML shell for every page. Exposes the self hosted fonts as CSS variables. Test only: with
 * the /design gallery on, a request carrying the root error header makes it throw, so the global
 * error page can be checked (B2-T155). Without the gallery (production) the headers are never read.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const galleryOn = isGalleryEnabled({
    NODE_ENV: process.env.NODE_ENV,
    DESIGN_GALLERY: process.env.DESIGN_GALLERY,
  });
  if (await shouldThrowRootError(galleryOn, headers))
    throw new Error("root error check: the root layout failed on purpose");
  return (
    <html lang="en" className={interTight.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
