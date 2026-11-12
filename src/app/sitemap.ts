import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

export const dynamic = "force-dynamic";

/** sitemap.xml (spec 0010, AC-3): only the homepage is public. Empty until the site origin is set. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin(process.env.BETTER_AUTH_URL);
  return origin ? [{ url: `${origin}/`, changeFrequency: "monthly", priority: 1 }] : [];
}
