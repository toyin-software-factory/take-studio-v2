import { CONTACT_EMAIL } from "./site";

/* ------------------------------------------------------------------ */
/* Facts only Toyin can supply (AC-8). `null` until supplied: the pages */
/* show no invented value and keep the Draft banner.                    */
/* ------------------------------------------------------------------ */

export type LegalEntity = {
  readonly name: string | null;
  readonly postalAddress: string | null;
  /** The address for privacy requests; the page uses `CONTACT_EMAIL` until this is set. */
  readonly privacyEmail: string | null;
  readonly governingLaw: string | null;
  readonly disputeVenue: string | null;
  /** ISO date the terms take effect. */
  readonly effectiveDate: string | null;
};

/** PLACEHOLDER: every value below is Toyin's to supply (spec 0015 Follow up, questions 1 and 2). */
export const LEGAL_ENTITY: LegalEntity = {
  name: null,
  postalAddress: null,
  privacyEmail: null,
  governingLaw: null,
  disputeVenue: null,
  effectiveDate: null,
};

/** The address shown for privacy requests: Toyin's, else the site contact. */
export function privacyContactEmail(entity: LegalEntity = LEGAL_ENTITY): string {
  return entity.privacyEmail ?? CONTACT_EMAIL;
}

/* ------------------------------------------------------------------ */
/* Toyin's answers to spec 0015 questions 3 to 7 (C-30, recommended).  */
/* Each answer from Toyin is a one line change here.                    */
/* ------------------------------------------------------------------ */

/** Toyin's answer to question 5 (C-30): 16. */
export const MINIMUM_AGE = 16;
/** Toyin's answer to question 6 (C-30): worldwide. */
export const SERVICE_REGION: "worldwide" | "limited" = "worldwide";
/** Toyin's answer to question 3 (C-30): `notice` is a line under the sign in form, no checkbox, nothing stored. */
export const AGREEMENT: "notice" | "checkbox" | "notice_and_stored" = "notice";
/** Toyin's answer to question 7 (C-30): `date_and_email` is the date plus an email for material changes. */
export const CHANGE_NOTICE: "date_and_email" | "date_only" = "date_and_email";
/** Toyin's answer to question 4 (C-30): "email us" until the button ships. False says "email us, done within 30 days"; true names the control. Shipped with B2-T33 (the account menu's Delete account). */
export const ACCOUNT_DELETE_SELF_SERVE = true;
/** Days we take to delete an account asked for by email. */
export const ACCOUNT_DELETE_EMAIL_DAYS = 30;

/* ------------------------------------------------------------------ */
/* Version and review (AC-7, AC-11).                                    */
/* ------------------------------------------------------------------ */

/** ISO dates, bumped by hand whenever the page text changes (the text hash test forces it). */
export const LEGAL_VERSION = {
  privacy: "2026-11-16",
  terms: "2026-11-14",
} as const;

export type Review = {
  readonly reviewedBy: string | null;
  readonly reviewedOn: string | null;
  readonly privacyVersion: string | null;
  readonly privacyTextHash: string | null;
  readonly termsVersion: string | null;
  readonly termsTextHash: string | null;
  readonly allowanceMinutes: number | null;
  readonly limitEnabled: boolean | null;
};

/** All `null` until a lawyer signs off; a small PR sets them (spec 0015 build plan step 8). */
export const REVIEW: Review = {
  reviewedBy: null,
  reviewedOn: null,
  privacyVersion: null,
  privacyTextHash: null,
  termsVersion: null,
  termsTextHash: null,
  allowanceMinutes: null,
  limitEnabled: null,
};
