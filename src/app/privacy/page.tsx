import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PRIVACY_TOC, PrivacyCopy } from "@/components/legal/privacy-copy";
import { LEGAL_ENTITY, LEGAL_VERSION } from "@/lib/legal-facts";
import { siteOrigin } from "@/lib/site";
import { loadLegalPage } from "@/server/legal/page";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "What Take Studio stores about you, why, how long, who else handles it, and how to delete it.";

export function generateMetadata(): Metadata {
  const origin = siteOrigin(process.env.BETTER_AUTH_URL);
  return {
    ...(origin ? { metadataBase: new URL(origin), alternates: { canonical: "/privacy" } } : {}),
    title: "Privacy Policy · Take Studio",
    description: DESCRIPTION,
  };
}

/** Privacy Policy (spec 0015): public, the same for a signed in reader, text from the facts file. */
export default async function PrivacyPage() {
  const data = await loadLegalPage();
  return (
    <LegalPage
      title="Privacy Policy"
      updated={LEGAL_VERSION.privacy}
      toc={PRIVACY_TOC}
      draftReasons={data.draftReasons}
      other={{ href: "/terms", label: "Read the Terms" }}
    >
      <PrivacyCopy entity={LEGAL_ENTITY} allowance={data.allowance} />
    </LegalPage>
  );
}
