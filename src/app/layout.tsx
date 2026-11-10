import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Take Studio",
  description:
    "Upload a video take and get it back trimmed, with a studio background and a transcript.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
