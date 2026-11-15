import { describe, expect, it } from "vitest";
import {
  DEEPGRAM_GRANT_URL,
  REALTIME_TOKEN,
  grantRequestBody,
  grantResponseSchema,
  mintRefusal,
  retryAfterSeconds,
} from "./realtime-rules";

describe("realtime token rules (spec 0021 AC-12)", () => {
  it("keeps the limits from the spec: 10 an hour, a daily cap above it, a 60 second token", () => {
    expect(REALTIME_TOKEN.perHour).toBe(10);
    expect(REALTIME_TOKEN.perDay).toBeGreaterThan(REALTIME_TOKEN.perHour);
    expect(REALTIME_TOKEN.ttlSeconds).toBe(60);
    expect(REALTIME_TOKEN.keepMs).toBeGreaterThan(REALTIME_TOKEN.dayMs);
  });

  it("refuses by the hourly window first, then the daily one, else lets it through", () => {
    expect(mintRefusal({ lastHour: 9, lastDay: 9 })).toBeNull();
    expect(mintRefusal({ lastHour: 10, lastDay: 10 })).toBe("hourly");
    expect(mintRefusal({ lastHour: 3, lastDay: 40 })).toBe("daily");
    expect(mintRefusal({ lastHour: 10, lastDay: 40 })).toBe("hourly");
  });

  it("builds the grant request and parses only a well formed answer", () => {
    expect(DEEPGRAM_GRANT_URL).toBe("https://api.deepgram.com/v1/auth/grant");
    expect(grantRequestBody()).toEqual({ ttl_seconds: 60 });
    expect(grantResponseSchema.safeParse({ access_token: "t", expires_in: 60 }).success).toBe(true);
    expect(grantResponseSchema.safeParse({ access_token: "", expires_in: 60 }).success).toBe(false);
    expect(grantResponseSchema.safeParse({ access_token: "t" }).success).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  it("is the time until the oldest mint leaves the window, rounded up, at least 1", () => {
    const base = { windowMs: REALTIME_TOKEN.hourMs, nowMs: 1_000_000 };
    expect(retryAfterSeconds({ ...base, oldestMintedAtMs: base.nowMs - 50 * 60 * 1000 })).toBe(600);
    expect(retryAfterSeconds({ ...base, oldestMintedAtMs: base.nowMs })).toBe(3600);
    expect(retryAfterSeconds({ ...base, oldestMintedAtMs: base.nowMs - 3_599_500 })).toBe(1);
    expect(retryAfterSeconds({ ...base, oldestMintedAtMs: base.nowMs - 4_000_000 })).toBe(1);
  });
});
