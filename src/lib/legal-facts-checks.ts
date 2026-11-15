import { DEEPGRAM_OPTIONS } from "./deepgram";
import { type LegalEntity, type Review, LEGAL_VERSION } from "./legal-facts-entity";

/** Does Deepgram stay opted out of training? The test pins this to the request options. */
export const DEEPGRAM_OPTS_OUT = DEEPGRAM_OPTIONS.mip_opt_out === "true";

/* ------------------------------------------------------------------ */
/* Text hash, draft state and launch check (AC-7, AC-8, AC-11).        */
/* ------------------------------------------------------------------ */

/** Collapses whitespace and trims, so layout changes never change the hash. */
export function normalizeLegalText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** SHA-256 (hex) of the normalized text. Web Crypto, so it runs in Node and in the Worker. */
export async function legalTextHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeLegalText(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The entity fields still `null`, by name. */
export function missingEntityFields(entity: LegalEntity): readonly string[] {
  return Object.entries(entity)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
}

/** What the live pages show now, to compare with what was reviewed. */
export type LegalNow = {
  /** `null` until the pages exist to hash (spec 0015 step 2); the gate then fails. */
  readonly privacyTextHash: string | null;
  readonly termsTextHash: string | null;
  /** `null` when the allowance setting could not be read. */
  readonly allowance: { readonly minutes: number; readonly limitEnabled: boolean } | null;
};

/**
 * Why the Draft banner must show, empty when it can go. Unreadable allowance counts as a
 * reason (it never passes on a guess).
 */
export function draftReasons(input: {
  readonly entity: LegalEntity;
  readonly review: Review;
  readonly version: typeof LEGAL_VERSION;
  readonly now: LegalNow;
}): readonly string[] {
  const { entity, review, version, now } = input;
  const reasons: string[] = missingEntityFields(entity).map((f) => `entity.${f} is not set`);
  for (const [key, value] of Object.entries(review)) {
    if (value === null) reasons.push(`review.${key} is not set`);
  }
  if (review.privacyVersion !== version.privacy) reasons.push("privacy version was not reviewed");
  if (review.termsVersion !== version.terms) reasons.push("terms version was not reviewed");
  if (now.privacyTextHash === null) reasons.push("privacy text hash is not available");
  else if (review.privacyTextHash !== now.privacyTextHash) reasons.push("privacy text changed");
  if (now.termsTextHash === null) reasons.push("terms text hash is not available");
  else if (review.termsTextHash !== now.termsTextHash) reasons.push("terms text changed");
  if (now.allowance === null) {
    reasons.push("allowance could not be read");
  } else if (
    review.allowanceMinutes !== now.allowance.minutes ||
    review.limitEnabled !== now.allowance.limitEnabled
  ) {
    reasons.push("allowance differs from the reviewed one");
  }
  return reasons;
}

/* ------------------------------------------------------------------ */
/* Drift flag for /sync and review (AC-10).                             */
/* ------------------------------------------------------------------ */

/**
 * Files whose change can alter what the pages promise: dependencies, env names, the rules and
 * options the copy quotes, the stored fields, sign in and cookies, what the AI and email send.
 * A diff touching any of them without `legal-facts.ts` is flagged by `pnpm legal:drift`.
 */
export const LEGAL_WATCHED_PATHS: readonly string[] = [
  "package.json",
  "src/lib/env.ts",
  "src/lib/take-rules.ts",
  "src/lib/usage-rules.ts",
  "src/lib/deepgram.ts",
  "src/lib/ai-edit.ts",
  "src/lib/ai-edit-config.ts",
  "src/lib/ai-edit-answer.ts",
  "src/lib/ai-edit-request.ts",
  "src/lib/sentry-options.ts",
  "src/lib/storage-lifecycle.ts",
  "src/server/auth.ts",
  "src/db/schema/",
  "src/lib/email/",
];

export const LEGAL_FACTS_PATH = "src/lib/legal-facts.ts";

/** The facts file and its split parts (`legal-facts-*.ts`, B2-T116): a change to any of them is a change to the facts. */
const isFactsFile = (path: string): boolean =>
  path === LEGAL_FACTS_PATH ||
  (path.startsWith("src/lib/legal-facts-") && path.endsWith(".ts") && !path.endsWith(".test.ts"));

/** The watched files this diff touches, or none when `legal-facts.ts` changed too. */
export function legalDriftFlag(changedPaths: readonly string[]): readonly string[] {
  if (changedPaths.some(isFactsFile)) return [];
  return changedPaths.filter((path) =>
    LEGAL_WATCHED_PATHS.some((w) => (w.endsWith("/") ? path.startsWith(w) : path === w)),
  );
}
