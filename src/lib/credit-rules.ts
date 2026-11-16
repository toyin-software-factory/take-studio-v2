/**
 * The "Edited with Take Studio" credit rules (spec 0026). Pure: `now` is passed in, nothing reads
 * the database or the clock. `creditFor` is the only place that decides whether a render carries
 * the credit.
 */

/** Settings keys in `app_setting` (spec 0026 AC-4, AC-5), read like `usage_limit_enabled`. */
export const CREDIT_STARTS_AT_KEY = "credit_starts_at";
export const CREDIT_ENABLED_KEY = "credit_enabled";

/** `take.credit_choice`: a paid creator's own choice. Null means no choice made. */
export const CREDIT_CHOICES = ["on", "off"] as const;
export type CreditChoice = (typeof CREDIT_CHOICES)[number];

/** The two plan groups the credit cares about. `creator` (spec 0024) counts as `paid`. */
export type CreditPlan = "free" | "paid";
export function creditPlanOf(plan: "free" | "creator" | "paid"): CreditPlan {
  return plan === "free" ? "free" : "paid";
}

/** The `app_setting` values this feature reads, already parsed. */
export type CreditSettings = {
  readonly enabled: boolean;
  /** Takes created before this moment never get the credit on a free plan. Null: not set. */
  readonly startsAt: Date | null;
};

/**
 * Reads the two settings from raw `app_setting` values (jsonb). Anything that is not the boolean
 * true leaves the credit off, and a start that is not a valid ISO date reads as not set (which
 * also means no credit), so a bad value never adds the credit by accident.
 */
export function parseCreditSettings(raw: {
  readonly [CREDIT_ENABLED_KEY]?: unknown;
  readonly [CREDIT_STARTS_AT_KEY]?: unknown;
}): CreditSettings {
  const at = raw[CREDIT_STARTS_AT_KEY];
  const parsed = typeof at === "string" && at !== "" ? new Date(at) : null;
  return {
    enabled: raw[CREDIT_ENABLED_KEY] === true,
    startsAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
  };
}

/**
 * Whether a render carries the credit (AC-4), in this order:
 * 1. `enabled` false, or `startsAt` empty or in the future: no credit.
 * 2. A paid plan: the credit only when the creator chose `on`.
 * 3. A free plan: the credit, unless the take was created before `startsAt`.
 */
export function creditFor(input: {
  readonly plan: CreditPlan;
  readonly choice: CreditChoice | null;
  readonly takeCreatedAt: Date;
  readonly enabled: boolean;
  readonly startsAt: Date | null;
  readonly now: Date;
}): boolean {
  const { startsAt } = input;
  if (!input.enabled || startsAt === null || startsAt.getTime() > input.now.getTime()) return false;
  if (input.plan === "paid") return input.choice === "on";
  return input.takeCreatedAt.getTime() >= startsAt.getTime();
}

/**
 * The look of the credit image (spec 0026 AC-1). The script that renders the PNG and the tests
 * read these, so the box and the text cannot drift apart. The colours are the theme tokens
 * `--color-media-glass` (black at 60%) and `--color-on-dark` (white).
 */
export const CREDIT_BOX = {
  text: "Edited with Take Studio",
  /** Height of the 1000 px wide image. */
  height: 120,
  radius: 24,
  fontSize: 52,
  /** `--color-media-glass`: black at 60%. */
  opacity: 0.6,
} as const;
