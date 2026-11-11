import { describe, expect, it } from "vitest";
import { parseJobEnv, parseUsageEnv, parseWebEnv } from "./env";

const r2 = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "take-studio",
};

describe("env", () => {
  it("parses a complete web env", () => {
    const env = parseWebEnv({
      ...r2,
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      TRIGGER_SECRET_KEY: "tr_dev_x",
    });
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
  });

  it("names missing variables without leaking values", () => {
    expect(() => parseJobEnv({ ...r2, R2_SECRET_ACCESS_KEY: "" })).toThrowError(
      /Invalid job env: R2_SECRET_ACCESS_KEY, DATABASE_URL/,
    );
    expect(() => parseJobEnv({ ...r2, R2_SECRET_ACCESS_KEY: "" })).not.toThrowError(/secret/);
  });

  it("parses the usage secret only when it is long enough", () => {
    const secret = "test-usage-hash-secret-0123456789abcdef";
    expect(parseUsageEnv({ USAGE_HASH_SECRET: secret }).USAGE_HASH_SECRET).toBe(secret);
    expect(() => parseUsageEnv({ USAGE_HASH_SECRET: "short" })).toThrowError(
      /Invalid usage env: USAGE_HASH_SECRET/,
    );
    expect(() => parseUsageEnv({})).toThrowError(/USAGE_HASH_SECRET/);
  });

  it("does not require the usage secret for the web env", () => {
    expect(() =>
      parseWebEnv({
        ...r2,
        BETTER_AUTH_SECRET: "x".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        TRIGGER_SECRET_KEY: "tr_dev_x",
      }),
    ).not.toThrow();
  });
});
