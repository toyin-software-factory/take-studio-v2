/**
 * Cut registries (spec 0002, `cut` table; AC-8). Stored as text with a CHECK. Add values only.
 */

/** cut.kind: what the cut removes. */
export const CUT_KINDS = ["pause", "false_start", "filler", "manual"] as const;
export type CutKind = (typeof CUT_KINDS)[number];

/** cut.proposed_by: who proposed the cut. */
export const CUT_PROPOSERS = ["rules", "ai", "creator"] as const;
export type CutProposer = (typeof CUT_PROPOSERS)[number];

/** Longest cut.reason, in characters. */
export const CUT_REASON_MAX = 280;
