/**
 * Guest drop box rules (spec 0023). Pure: the numbers and the settings parser live here, the
 * database and the cookie live in `src/server/guest/`. Defaults are in code, no rows are seeded.
 */

export const GUEST_MAX_BYTES = 500 * 1024 * 1024;
export const GUEST_MAX_SECONDS = 3 * 60;
export const GUEST_TTL_HOURS = 24;
export const GUEST_DROPS_PER_ADDRESS_PER_DAY = 3;
export const GUEST_DAILY_MINUTES_DEFAULT = 600;
export const GUEST_EMAIL_SUFFIX = "@guest.invalid";
export const GUEST_COOKIE = "ts_guest";

export const GUEST_UPLOAD_ENABLED_KEY = "guest_upload_enabled";
export const GUEST_DAILY_MINUTES_KEY = "guest_daily_minutes";

export type GuestSettings = {
  readonly enabled: boolean;
  readonly dailyMinutes: number;
};

/** Anything but a clear `false` keeps the drop box on; a bad minutes value falls back to 600. */
export function parseGuestSettings(raw: {
  readonly [GUEST_UPLOAD_ENABLED_KEY]?: unknown;
  readonly [GUEST_DAILY_MINUTES_KEY]?: unknown;
}): GuestSettings {
  const minutes = raw[GUEST_DAILY_MINUTES_KEY];
  const valid = typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 0;
  return {
    enabled: raw[GUEST_UPLOAD_ENABLED_KEY] !== false,
    dailyMinutes: valid ? minutes : GUEST_DAILY_MINUTES_DEFAULT,
  };
}

export function guestEmail(id: string): string {
  return `guest-${id}${GUEST_EMAIL_SUFFIX}`;
}

/** UTC calendar day, `YYYY-MM-DD`. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
