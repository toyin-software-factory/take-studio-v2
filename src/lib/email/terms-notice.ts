/**
 * The notice email for a material change to the Terms or Privacy Policy (spec 0015 decision 7,
 * `CHANGE_NOTICE = date_and_email`). Pure: the template, the notice list, who gets it and the
 * Resend idempotency key. The one off script `scripts/send-terms-notice.ts` does the I/O.
 * A notice is one plain email: what changed in a sentence or two, the link, the date. No
 * marketing, no unsubscribe link (it is not a take email and the take email opt out is ignored).
 */
import { LEGAL_LINKS } from "@/lib/legal-links";
import { type Email, render } from "./templates";

export type Notice = {
  /** The date shown in the email (ISO, the `LEGAL_VERSION` date of the change). */
  readonly date: string;
  readonly subject: string;
  /** One or two plain sentences saying what changed. */
  readonly summary: readonly string[];
};

/** Every notice we have ever sent or may send, by id. A later change adds one entry. */
export const NOTICES: Readonly<Record<string, Notice>> = {
  "2026-11-credit": {
    date: "2026-11-16",
    subject: "We updated the Take Studio Terms",
    summary: [
      "Videos you make on a free account will end with a short “Edited with Take Studio” credit in the corner. Videos made before the change, takes handed back as they are, and your original files carry no credit.",
    ],
  },
};

export const NOTICE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;

export type Recipient = {
  readonly id: string;
  readonly email: string;
  readonly guest: boolean;
  /** Ignored on purpose: a Terms notice is not a take email. */
  readonly takeEmails: boolean;
};

/** Every real account with an address. Guests who never claimed an account are skipped. */
export function selectRecipients(users: readonly Recipient[]): readonly Recipient[] {
  return users.filter((u) => !u.guest && u.email.trim() !== "");
}

/** One key per notice and account: a rerun never sends twice (Resend keeps a key for 24 hours). */
export function noticeKey(noticeId: string, userId: string): string {
  return `terms-${noticeId}-${userId}`;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function termsNoticeEmail(notice: Notice, origin: string): Email {
  const url = new URL(LEGAL_LINKS.terms.href, origin).toString();
  const { html, text } = render({
    heading: notice.subject,
    paragraphs: [...notice.summary, `This change is dated ${formatDate(notice.date)}.`],
    button: { label: "Read the Terms", url },
    footer: ["You get this email because you have a Take Studio account."],
  });
  return { subject: notice.subject, html, text };
}
