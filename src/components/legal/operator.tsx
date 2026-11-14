import type { LegalEntity } from "@/lib/legal-facts";

/**
 * Who runs the service. A value Toyin has not supplied yet is left out, never invented (AC-8), so
 * the hash test fills every field with a token to fix the wording.
 */
export function Operator({ entity }: Readonly<{ entity: LegalEntity }>) {
  const lines: [string, string][] = [];
  if (entity.name) lines.push(["Operator", entity.name]);
  if (entity.postalAddress) lines.push(["Address", entity.postalAddress]);
  if (lines.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {lines.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Stand in values for the hash: every field set, so every sentence is in the hashed text. */
export const ENTITY_TEMPLATE: LegalEntity = {
  name: "{company name}",
  postalAddress: "{postal address}",
  privacyEmail: "{privacy email}",
  governingLaw: "{governing law}",
  disputeVenue: "{dispute venue}",
  effectiveDate: "{effective date}",
};
