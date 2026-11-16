/**
 * The facts the Privacy and Terms pages state (spec 0015). Pure: no I/O, no clock. Numbers come
 * from the rule constants and are never retyped; the services and the stored data are listed here
 * once, and `legal-facts.test.ts` fails when the code and this file drift apart.
 *
 * Changing anything the pages promise (a service, a cookie, a stored field, a retention period, a
 * new event, a payment step) means changing this file, the page copy and the `LEGAL_VERSION`
 * date together.
 *
 * Split by job (B2-T116, no change to any fact): `legal-facts-entity` (the facts only Toyin can
 * supply, the placeholder decisions, the review record), `legal-facts-processors` (services and
 * packages), `legal-facts-data` (what we collect, cookies, numbers) and `legal-facts-checks`
 * (the text hash, the draft state and the drift flag). This file only re-exports them, and
 * `pnpm legal:drift` counts a change to any `legal-facts-*.ts` file as a change to the facts.
 */
export {
  ACCOUNT_DELETE_EMAIL_DAYS,
  ACCOUNT_DELETE_SELF_SERVE,
  AGREEMENT,
  CHANGE_NOTICE,
  LEGAL_ENTITY,
  LEGAL_VERSION,
  MINIMUM_AGE,
  REVIEW,
  SERVICE_REGION,
  privacyContactEmail,
  type LegalEntity,
  type Review,
} from "./legal-facts-entity";
export {
  NON_DATA_PACKAGES,
  NON_PROCESSOR_ENV,
  PROCESSORS,
  TURNSTILE_ADDENDUM_URL,
  type Processor,
} from "./legal-facts-processors";
export {
  CHOICES,
  COLLECTED,
  COOKIES,
  DEVICE_STORAGE,
  LEGAL_NUMBERS,
  PUBLIC_VIEWER,
  type Collected,
  type CookieFact,
  type DeviceStorageFact,
} from "./legal-facts-data";
export {
  DEEPGRAM_OPTS_OUT,
  LEGAL_FACTS_PATH,
  LEGAL_WATCHED_PATHS,
  draftReasons,
  legalDriftFlag,
  legalTextHash,
  missingEntityFields,
  normalizeLegalText,
  type LegalNow,
} from "./legal-facts-checks";
