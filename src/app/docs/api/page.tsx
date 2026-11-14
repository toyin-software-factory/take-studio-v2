import type { Metadata } from "next";
import { ApiDocsPage } from "@/components/docs/api-docs-page";
import { siteOrigin } from "@/lib/site";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "The Take Studio API: sign in with a key, upload a take, run it and fetch the finished video from your own code.";

export function generateMetadata(): Metadata {
  const origin = siteOrigin(process.env.BETTER_AUTH_URL);
  return {
    ...(origin ? { metadataBase: new URL(origin), alternates: { canonical: "/docs/api" } } : {}),
    title: "API · Take Studio",
    description: DESCRIPTION,
  };
}

/** The public API docs (spec 0018 AC-11): no sign in, the same for everyone, built from the registry. */
export default function ApiDocs() {
  return <ApiDocsPage />;
}
