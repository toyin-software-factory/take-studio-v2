import { describe, expect, it } from "vitest";
import { isInsightsViewer } from "./env";

describe("isInsightsViewer (spec 0016, AC-8)", () => {
  it("accepts only the configured user", () => {
    const env = { INSIGHTS_VIEWER_USER_ID: "user-1" };
    expect(isInsightsViewer("user-1", env)).toBe(true);
    expect(isInsightsViewer("user-2", env)).toBe(false);
    expect(isInsightsViewer(undefined, env)).toBe(false);
  });

  it("is false, never a throw, when the config is missing or empty", () => {
    expect(isInsightsViewer("user-1", {})).toBe(false);
    expect(isInsightsViewer("user-1", { INSIGHTS_VIEWER_USER_ID: "" })).toBe(false);
  });
});
