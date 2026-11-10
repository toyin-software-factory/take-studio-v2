import { describe, expect, it } from "vitest";
import { parseJobEnv, parseWebEnv } from "./env";

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
});
