import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/**
 * The `SoftwareApplication` structured data for the homepage (spec 0010, AC-3). Built from the
 * site's own constants; `url` is left out when the site origin is not known. Serialised with `<`
 * escaped so the JSON can never close its own script tag.
 */
export function softwareApplicationLd(origin: string | null): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    ...(origin ? { url: `${origin}/` } : {}),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

export function JsonLd({ origin }: { readonly origin: string | null }) {
  const json = JSON.stringify(softwareApplicationLd(origin)).replaceAll("<", "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
