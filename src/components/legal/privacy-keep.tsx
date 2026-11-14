import {
  ACCOUNT_DELETE_EMAIL_DAYS,
  ACCOUNT_DELETE_SELF_SERVE,
  LEGAL_NUMBERS,
  privacyContactEmail,
  type LegalEntity,
} from "@/lib/legal-facts";
import { AllowanceNote, type AllowanceState } from "./allowance-note";
import { LegalList, LegalSection } from "./section";

/** Retention, deletion, the allowance and the upload limits (AC-3, AC-13). */
export function KeepSection({
  entity,
  allowance,
}: Readonly<{ entity: LegalEntity; allowance: AllowanceState }>) {
  const n = LEGAL_NUMBERS;
  return (
    <LegalSection id="keep" title="How long we keep your videos, and deleting them">
      <p>
        Your original and finished videos are kept for {n.retentionDays} days from the end of the
        upload, then deleted automatically. Transcripts, cuts and edits stay until you delete the
        take. You can delete any take at any time, and every file and record for it is removed.
      </p>
      {ACCOUNT_DELETE_SELF_SERVE ? (
        <p>
          You can delete your account from the account menu. That removes your takes, files and
          account details.
        </p>
      ) : (
        <p>
          To delete your account, email{" "}
          <a
            href={`mailto:${privacyContactEmail(entity)}`}
            className="underline underline-offset-4"
          >
            {privacyContactEmail(entity)}
          </a>
          . We do it within {ACCOUNT_DELETE_EMAIL_DAYS} days. It removes your takes, files and
          account details.
        </p>
      )}
      <p>
        One thing stays after an account is deleted: your monthly usage count. It is stored under a
        keyed hash of your email, so it holds no readable email or ID. We keep it to stop people
        from getting a fresh allowance by deleting and signing up again.
      </p>
      <AllowanceNote state={allowance} />
      <p>Uploads are limited to:</p>
      <LegalList
        items={[
          `${n.maxMinutes} minutes of video`,
          `${n.maxGigabytes} GB per file`,
          `${n.maxLongSide} by ${n.maxShortSide} pixels at most`,
        ]}
      />
    </LegalSection>
  );
}
