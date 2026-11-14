import type { AllowanceState } from "@/components/legal/allowance-note";
import {
  LEGAL_ENTITY,
  LEGAL_VERSION,
  REVIEW,
  draftReasons,
  type LegalNow,
} from "@/lib/legal-facts";
import { recordedHash } from "@/lib/legal-text-hashes";
import { getDb } from "../request";
import { legalAllowance } from "./allowance";

export type LegalPageData = {
  readonly allowance: AllowanceState;
  readonly draftReasons: readonly string[];
};

/** What the allowance note says for the value read (or not read) from the settings. */
export function allowanceState(allowance: LegalNow["allowance"]): AllowanceState {
  if (allowance === null) return { kind: "unavailable" };
  return allowance.limitEnabled
    ? { kind: "on", minutes: String(allowance.minutes) }
    : { kind: "off" };
}

/**
 * Everything a legal page needs per request: the allowance wording and the Draft banner reasons.
 * The page hashes come from the recorded history, which the unit test ties to the copy.
 */
export async function loadLegalPage(): Promise<LegalPageData> {
  const allowance = await legalAllowance(getDb);
  const reasons = draftReasons({
    entity: LEGAL_ENTITY,
    review: REVIEW,
    version: LEGAL_VERSION,
    now: {
      privacyTextHash: recordedHash("privacy", LEGAL_VERSION.privacy),
      termsTextHash: recordedHash("terms", LEGAL_VERSION.terms),
      allowance,
    },
  });
  return { allowance: allowanceState(allowance), draftReasons: reasons };
}
