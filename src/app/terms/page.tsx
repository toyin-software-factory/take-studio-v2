import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { TERMS_TOC, TermsCopy } from "@/components/legal/terms-copy";
import { LEGAL_ENTITY, LEGAL_VERSION } from "@/lib/legal-facts";
import { siteOrigin } from "@/lib/site";
import { loadLegalPage } from "@/server/legal/page";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "The rules for using Take Studio: your account, your videos, the free allowance and our limits.";

export function generateMetadata(): Metadata {
  const origin = siteOrigin(process.env.BETTER_AUTH_URL);
  return {
    ...(origin ? { metadataBase: new URL(origin), alternates: { canonical: "/terms" } } : {}),
    title: "Terms of Use · Take Studio",
    description: DESCRIPTION,
  };
}

/** Terms of Use (spec 0015): public, the same for a signed in reader, text from the facts file. */
export default async function TermsPage() {
  const data = await loadLegalPage();
  return (
    <LegalPage
      title="Terms of Use"
      updated={LEGAL_VERSION.terms}
      toc={TERMS_TOC}
      draftReasons={data.draftReasons}
      other={{ href: "/privacy", label: "Read the Privacy Policy" }}
    >
      <TermsCopy entity={LEGAL_ENTITY} allowance={data.allowance} />
    </LegalPage>
  );
}
