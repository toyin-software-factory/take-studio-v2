import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { LEGAL_VERSION } from "@/lib/legal-facts";

/** How long a signed in creator sees the notice after the Terms change (spec 0026 AC-13, C3). */
export const TERMS_NOTICE_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Whether the "Terms updated" notice shows: from the Terms version date for 14 days. Pure, from
 * the date alone, so nothing is stored about the creator (no cookie, no column, no legal fact).
 */
export function termsNoticeVisible(now: Date, termsVersion: string = LEGAL_VERSION.terms): boolean {
  const start = Date.parse(`${termsVersion}T00:00:00Z`);
  if (Number.isNaN(start)) return false;
  const age = now.getTime() - start;
  return age >= 0 && age < TERMS_NOTICE_DAYS * DAY_MS;
}

/** A short notice on the library for signed in creators: free videos will carry a credit. */
export function TermsUpdateNotice({ now }: { readonly now: Date }) {
  if (!termsNoticeVisible(now)) return null;
  return (
    <p
      role="note"
      data-testid="terms-update-notice"
      className="rounded-md border border-border px-4 py-3 text-small text-muted-foreground"
    >
      We updated our Terms on {LEGAL_VERSION.terms}. Finished videos made on a free account will end
      with a short &quot;Edited with Take Studio&quot; credit.{" "}
      <Link
        href={LEGAL_LINKS.terms.href}
        className="underline underline-offset-2 pointer-coarse:inline-block pointer-coarse:min-h-11"
      >
        Read the Terms
      </Link>
      .
    </p>
  );
}
