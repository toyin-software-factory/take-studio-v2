import { describe, expect, it } from "vitest";
import {
  DEEPGRAM_GRANT_URL,
  REALTIME_TOKEN,
  grantRequestBody,
  grantResponseSchema,
  mintRefusal,
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
