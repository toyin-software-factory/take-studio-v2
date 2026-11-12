import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, siteOrigin } from "@/lib/site";

export const dynamic = "force-dynamic";

/** robots.txt (spec 0010, AC-3): the homepage is open, the app, the gallery and the API are not. */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin(process.env.BETTER_AUTH_URL);
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  };
}
