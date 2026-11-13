import { chargedMonth } from "./billing";

/**
 * Pure monthly usage rules (spec 0014). They never read the database or the clock: `now` is
 * passed in, so the month edge at midnight UTC is exact in tests.
 */

/** Defaults until Toyin answers the open decisions (spec 0014): one place each, one line to change. */
export const FREE_MONTHLY_SECONDS_DEFAULT = 3600;
/** Settings keys in `app_setting` (spec 0014 AC-2, AC-11). */
export const FREE_MONTHLY_SECONDS_KEY = "free_monthly_seconds";
export const USAGE_LIMIT_ENABLED_KEY = "usage_limit_enabled";
/** From this share of the allowance used, the notice says how many minutes are left (AC-9). */
export const USAGE_NOTICE_FROM = 0.8;

/** The `app_setting` values this feature reads, already parsed. */
export type UsageSettings = {
  readonly freeMonthlySeconds: number;
  readonly limitEnabled: boolean;
};

/** The account the allowance is for. Billing (C-26) adds a plan or an override here later. */
export type UsageAccount = {
  readonly accountHash: string;
};

/**
 * Reads the two settings from raw `app_setting` values (jsonb). A missing, non numeric,
 * negative or fractional allowance falls back to the default; `limitEnabled` is true only for
 * the boolean true, so a bad value leaves the limit off rather than refusing everyone.
 */
export function parseUsageSettings(raw: {
  readonly [FREE_MONTHLY_SECONDS_KEY]?: unknown;
  readonly [USAGE_LIMIT_ENABLED_KEY]?: unknown;
}): UsageSettings {
  const seconds = raw[FREE_MONTHLY_SECONDS_KEY];
  const valid = typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 0;
  return {
    freeMonthlySeconds: valid ? seconds : FREE_MONTHLY_SECONDS_DEFAULT,
    limitEnabled: raw[USAGE_LIMIT_ENABLED_KEY] === true,
  };
}

/**
 * The only place that turns settings into an allowance for an account (AC-2, AC-12). Billing
 * later adds a plan lookup and a founding member override inside this function.
 */
export function monthlyAllowanceSeconds(settings: UsageSettings, _account: UsageAccount): number {
  return settings.freeMonthlySeconds;
}

/** Seconds left this month, never negative. */
export function remainingSeconds(allowance: number, used: number): number {
  return Math.max(0, allowance - used);
}

/** Whether a charge of `charge` seconds fits (AC-4): `used + charge <= allowance`. */
export function fitsInAllowance(allowance: number, used: number, charge: number): boolean {
  return used + charge <= allowance;
}

/** First day of the next UTC month as `YYYY-MM-DD` (AC-8 `resetsOn`). */
export function resetsOn(now: Date): string {
  return chargedMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
}

/** The four numbers of `GET /api/usage` and of the `limit_exceeded` bodies (AC-8). */
export type UsageSummary = {
  readonly usedSeconds: number;
  readonly allowanceSeconds: number;
  readonly remainingSeconds: number;
  readonly resetsOn: string;
};

export function usageSummary(allowance: number, used: number, now: Date): UsageSummary {
  return {
    usedSeconds: used,
    allowanceSeconds: allowance,
    remainingSeconds: remainingSeconds(allowance, used),
    resetsOn: resetsOn(now),
  };
}

/**
 * Whole minutes for display (AC-9): minutes left rounded down, minutes used = allowance
 * minutes minus minutes left (so used is rounded up and the two add up to the allowance).
 */
export function usageDisplay(
  allowance: number,
  used: number,
): {
  readonly usedMinutes: number;
  readonly leftMinutes: number;
  readonly allowanceMinutes: number;
} {
  const allowanceMinutes = Math.floor(allowance / 60);
  const leftMinutes = Math.min(
    allowanceMinutes,
    Math.floor(remainingSeconds(allowance, used) / 60),
  );
  return { usedMinutes: allowanceMinutes - leftMinutes, leftMinutes, allowanceMinutes };
}

export type UsageNotice = "none" | "low" | "used_up";

/** Which notice the meter shows (AC-9): nothing, "n minutes left" from 80% used, or used up. */
export function usageNotice(allowance: number, used: number): UsageNotice {
  if (remainingSeconds(allowance, used) <= 0) return "used_up";
  return allowance > 0 && used / allowance >= USAGE_NOTICE_FROM ? "low" : "none";
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** `2026-12-01` -> `1 Dec` (UTC; the date is a plain calendar date, never shifted). */
export function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTH_NAMES[(month ?? 1) - 1] ?? ""}`.trim();
}

/** `YYYY-MM-DD` of an instant in UTC. */
function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The message for a take refused at the limit (AC-6). The reset date and the video's expiry
 * date come from the numbers, never typed. When the video expires before the reset the
 * message says so and asks for a new upload instead of a retry.
 */
export function limitExceededMessage(input: {
  readonly resetsOn: string;
  /** `take.video_expires_at`, null when unknown. */
  readonly videoExpiresAt: Date | null;
}): string {
  const reset = shortDate(input.resetsOn);
  if (input.videoExpiresAt === null) {
    return `This month's allowance is used up. Try again from ${reset}, or delete this take.`;
  }
  const expiryDate = utcDate(input.videoExpiresAt);
  const expiry = shortDate(expiryDate);
  // ISO dates compare as text: the video is gone before the minutes come back.
  if (expiryDate < input.resetsOn) {
    return `Your upload is kept until ${expiry}, before your minutes come back on ${reset}. Upload it again then.`;
  }
  return `This month's allowance is used up. Your upload is kept until ${expiry}: try again from ${reset}, or delete it.`;
}
