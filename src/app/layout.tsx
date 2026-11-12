import type { Metadata } from "next";
import { interTight } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Take Studio",
  description:
    "Upload a video take and get it back trimmed, with a studio background and a transcript.",
};

/** Root HTML shell for every page. Exposes the self hosted fonts as CSS variables. */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={interTight.variable}>
      <body>{children}</body>
    </html>
  );
}
