import {
  ACCOUNT_DELETE_SELF_SERVE,
  CHANGE_NOTICE,
  LEGAL_NUMBERS,
  MINIMUM_AGE,
  type LegalEntity,
} from "@/lib/legal-facts";
import { AllowanceNote, type AllowanceState } from "./allowance-note";
import { Operator } from "./operator";
import { LegalList, LegalSection } from "./section";

export const TERMS_TOC = [
  { id: "using", title: "Using Take Studio" },
  { id: "account", title: "Your account" },
  { id: "content", title: "Your videos, transcripts and scripts" },
  { id: "rules", title: "What you may not upload" },
  { id: "storage", title: "Storage and deleting" },
  { id: "usage", title: "How we count use" },
  { id: "allowance", title: "The free allowance" },
  { id: "api", title: "Using the API" },
  { id: "service", title: "Availability" },
  { id: "liability", title: "Liability and governing law" },
  { id: "changes", title: "Changes to these terms" },
] as const;

/** The Terms copy (AC-6). The hashed region, so layout stays outside it. */
export function TermsCopy({
  entity,
  allowance,
}: Readonly<{ entity: LegalEntity; allowance: AllowanceState }>) {
  return (
    <>
      <LegalSection id="using" title="Using Take Studio">
        <p>
          These terms are the rules for using Take Studio. By signing in you agree to them and to
          the Privacy Policy. You must be at least {MINIMUM_AGE} years old.
        </p>
        <Operator entity={entity} />
      </LegalSection>
      <LegalSection id="account" title="Your account">
        <p>
          You sign in with Google or with a one time link we email you. The link works for you only,
          so do not share it. You are responsible for what happens in your account.
        </p>
      </LegalSection>
      <LegalSection id="content" title="Your videos, transcripts and scripts">
        <p>
          You keep all rights in your videos, transcripts and scripts. You give us only the right to
          process them and show them to you, so we can make your finished video.
        </p>
      </LegalSection>
      <LegalSection id="rules" title="What you may not upload">
        <LegalList
          items={[
            "Anything illegal, or that you have no right to use.",
            "Anything that harms or harasses other people.",
            "Files meant to break or overload the service.",
          ]}
        />
        <p>
          Each file can be up to {LEGAL_NUMBERS.maxMinutes} minutes and {LEGAL_NUMBERS.maxGigabytes}{" "}
          GB.
        </p>
      </LegalSection>
      <LegalSection id="storage" title="Storage and deleting">
        <p>
          We keep your videos for {LEGAL_NUMBERS.retentionDays} days, then delete them. You can
          delete any take sooner.{" "}
          {ACCOUNT_DELETE_SELF_SERVE
            ? "You can delete your account from the account menu."
            : "To delete your account, email us; the Privacy Policy says how."}
        </p>
      </LegalSection>
      <LegalSection id="usage" title="How we count use">
        <p>
          We count what you do in Take Studio (for example that you uploaded or downloaded a take)
          to run and improve the service. The Privacy Policy lists what we count.
        </p>
      </LegalSection>
      <LegalSection id="allowance" title="The free allowance">
        <AllowanceNote state={allowance} />
      </LegalSection>
      <LegalSection id="api" title="Using the API">
        <p>
          You can make an API key and use it to reach your own takes from your own tools. Keep the
          key secret: anyone who has it can act as you, so revoke it if it leaks. Requests with a
          key are limited per minute, use the same free allowance as the website, and you may not
          resell access to Take Studio through a key. You can also connect an AI assistant to your
          account with a key. What it does there counts as done by you, so connect only assistants
          you trust.
        </p>
      </LegalSection>
      <LegalSection id="service" title="Availability">
        <p>
          We work to keep Take Studio running, but we do not promise it will always be available or
          free of errors.
        </p>
      </LegalSection>
      <LegalSection id="liability" title="Liability and governing law">
        <p>
          Take Studio is provided as it is. As far as the law allows, we are not liable for lost
          videos, lost profit or indirect harm from using it.
        </p>
        {entity.governingLaw ? (
          <p>
            These terms are governed by the law of {entity.governingLaw}
            {entity.disputeVenue ? `, and disputes are heard in ${entity.disputeVenue}` : ""}.
          </p>
        ) : null}
        {entity.effectiveDate ? <p>These terms take effect on {entity.effectiveDate}.</p> : null}
      </LegalSection>
      <LegalSection id="changes" title="Changes to these terms">
        <p>
          The date at the top shows when these terms last changed.
          {CHANGE_NOTICE === "date_and_email" ? " If a change matters, we also email you." : ""}
        </p>
      </LegalSection>
    </>
  );
}
