import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HomePage } from "@/components/home/home-page";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteOrigin } from "@/lib/site";
import { getSession } from "@/server/request";

export const dynamic = "force-dynamic";

/**
 * The homepage's title, description, canonical URL and share cards (spec 0010, AC-3). The share
 * image is `opengraph-image.jpg` next to this file; the absolute URLs need the site origin, which
 * comes from `BETTER_AUTH_URL`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const origin = siteOrigin(process.env.BETTER_AUTH_URL);
  const title = `${SITE_TITLE} · ${SITE_NAME}`;
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title,
    description: SITE_DESCRIPTION,
    // Relative URLs resolve against `metadataBase`; without an origin they are left out.
    ...(origin ? { alternates: { canonical: "/" } } : {}),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description: SITE_DESCRIPTION,
      ...(origin ? { url: "/" } : {}),
    },
    twitter: { card: "summary_large_image", title, description: SITE_DESCRIPTION },
  };
}

/**
 * Home: the public homepage (spec 0010). A signed in visitor is sent on to the library with a
 * 307, so this file imports nothing from the signed in app (that code stays off the homepage's
 * first load: spec 0010, AC-10).
 */
export default async function Home() {
  if (await getSession(await headers())) redirect("/library");
  return <HomePage origin={siteOrigin(process.env.BETTER_AUTH_URL)} />;
}
