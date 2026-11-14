import type { LegalEntity } from "@/lib/legal-facts";
import { CHANGE_NOTICE } from "@/lib/legal-facts";
import type { AllowanceState } from "./allowance-note";
import { ChoicesSection, CollectedSection, CookiesSection } from "./privacy-data";
import { KeepSection } from "./privacy-keep";
import { ServicesSection } from "./privacy-services";
import { Operator } from "./operator";
import { LegalSection } from "./section";

/** The table of contents for the Privacy page: id and title of every section, in order. */
export const PRIVACY_TOC = [
  { id: "who", title: "Who we are" },
  { id: "collect", title: "What we collect, why, and how long we keep it" },
  { id: "keep", title: "How long we keep your videos, and deleting them" },
  { id: "services", title: "Who else handles your data" },
  { id: "cookies", title: "Cookies" },
  { id: "choices", title: "Your choices and how to reach us" },
  { id: "changes", title: "Changes to this page" },
] as const;

/** The Privacy copy (spec 0015 AC-3 to AC-5). This is the hashed region: no layout inside it. */
export function PrivacyCopy({
  entity,
  allowance,
}: Readonly<{ entity: LegalEntity; allowance: AllowanceState }>) {
  return (
    <>
      <LegalSection id="who" title="Who we are">
        <p>
          Take Studio takes a video you upload and gives it back trimmed, with a studio background
          and a transcript. This page says what we do with your data, in plain words.
        </p>
        <Operator entity={entity} />
      </LegalSection>
      <CollectedSection />
      <KeepSection entity={entity} allowance={allowance} />
      <ServicesSection />
      <CookiesSection />
      <ChoicesSection entity={entity} />
      <LegalSection id="changes" title="Changes to this page">
        <p>
          The date at the top shows when this page last changed.
          {CHANGE_NOTICE === "date_and_email"
            ? " If a change matters, such as a new service or a longer retention, we also email you."
            : ""}
        </p>
      </LegalSection>
    </>
  );
}
