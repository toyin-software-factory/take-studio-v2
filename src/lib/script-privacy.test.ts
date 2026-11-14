import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENT_NAMES, parseEventProps } from "./analytics-events";
import { jobTagsFrom, scrubEvent } from "./sentry-scrub";

// Spec 0021 AC-8: the script a creator types is private. It must not reach Sentry events,
// analytics events or job payloads. Synthetic text only.
const SCRIPT = "Zebra quartz synthetic script line about gardening tools";

describe("the script stays out of Sentry events", () => {
  it("drops it from request bodies, extra and user data", () => {
    const event = scrubEvent({
      message: "upload create failed",
      request: { url: "https://x.test/api/uploads", method: "POST", data: { script: SCRIPT } },
      extra: { script: SCRIPT, takeId: "take_1" },
      user: { id: "u1", script: SCRIPT },
    });
    expect(JSON.stringify(event)).not.toContain(SCRIPT);
  });

  it("drops it from breadcrumb data", () => {
    const event = scrubEvent({
      breadcrumbs: [{ category: "fetch", data: { script: SCRIPT, body: SCRIPT } }],
    });
    expect(JSON.stringify(event)).not.toContain(SCRIPT);
  });
});

describe("the script stays out of job tags and payloads", () => {
  it("jobTagsFrom keeps IDs and never a script", () => {
    const tags = jobTagsFrom({ takeId: "take_1", jobId: "job_1", script: SCRIPT });
    expect(tags).toEqual({ takeId: "take_1", jobId: "job_1" });
  });

  it("a script is not an ID, so it is not a tag", () => {
    expect(JSON.stringify(jobTagsFrom({ takeId: SCRIPT }))).not.toContain(SCRIPT);
  });
});

describe("the script stays out of analytics events", () => {
  it("no event accepts a script property", () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(parseEventProps(name, { script: SCRIPT }), name).toBeNull();
    }
  });
});
