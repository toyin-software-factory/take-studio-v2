import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

export const dynamic = "force-dynamic";

/** sitemap.xml (spec 0010, AC-3): the homepage, Privacy and Terms are public. Empty until the site origin is set. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin(process.env.BETTER_AUTH_URL);
  return origin
    ? [
        { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
        { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
        { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.3 },
      ]
    : [];
}
