/** Shown above the heading while the legal review is not recorded for what is on the page. */
export function DraftBanner({ reasons }: Readonly<{ reasons: readonly string[] }>) {
  if (reasons.length === 0) return null;
  return (
    <p
      role="note"
      className="rounded-md border border-line bg-surface px-4 py-3"
      data-testid="legal-draft-banner"
    >
      <strong className="font-medium">Draft, pending review.</strong> This page is a plain language
      first draft and has not been reviewed by a lawyer yet.
    </p>
  );
}
