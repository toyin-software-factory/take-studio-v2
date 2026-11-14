import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { VIDEO_RETENTION_DAYS } from "@/lib/take-rules";

const LINK_CLASS =
  "-mx-2 -my-3.5 inline rounded-sm px-2 py-3.5 underline underline-offset-2 outline-hidden hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring";

/** The notice under the sign in form (spec 0015 AC-2, C-30): links, no checkbox, nothing stored. */
export function SignInNotice() {
  return (
    <p data-testid="sign-in-legal-notice" className="text-small text-muted-foreground">
      By continuing you agree to the{" "}
      <Link href={LEGAL_LINKS.terms.href} className={LINK_CLASS}>
        {LEGAL_LINKS.terms.label}
      </Link>{" "}
      and the{" "}
      <Link href={LEGAL_LINKS.privacy.href} className={LINK_CLASS}>
        {LEGAL_LINKS.privacy.label}
      </Link>
      .
    </p>
  );
}

/** One line in the upload area: the retention promise, with the Privacy link next to it (AC-2). */
export function UploadNote() {
  return (
    <p data-testid="upload-legal-note" className="text-small text-muted-foreground">
      We delete videos after {VIDEO_RETENTION_DAYS} days, or sooner when you delete them.{" "}
      <Link href={LEGAL_LINKS.privacy.href} className={LINK_CLASS}>
        {LEGAL_LINKS.privacy.label}
      </Link>
    </p>
  );
}
