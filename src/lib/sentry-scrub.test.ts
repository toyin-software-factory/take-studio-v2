import { describe, expect, it } from "vitest";
import {
  REDACTED,
  jobTagsFrom,
  redactText,
  scrubBreadcrumb,
  scrubEvent,
  stripQuery,
} from "./sentry-scrub";

const presigned =
  "https://acct.r2.cloudflarestorage.com/take-studio/takes/abc/original.mov?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef";
const presignedOtherHost =
  "https://cdn.example.com/file.mp4?X-Amz-Credential=AKIA%2F123&X-Amz-Signature=beef";

describe("redactText", () => {
  it("redacts presigned and R2 URLs wherever they appear", () => {
    expect(redactText(`fetch failed for ${presigned}`)).toBe(`fetch failed for ${REDACTED}`);
    expect(redactText(`got ${presignedOtherHost} back`)).toBe(`got ${REDACTED} back`);
    expect(redactText("https://ACCT.R2.CloudflareStorage.com/x")).toBe(REDACTED);
  });

  it("keeps ordinary URLs but drops their query string", () => {
    expect(redactText("GET https://take-studio.dev/takes/abc?token=secret#x failed")).toBe(
      "GET https://take-studio.dev/takes/abc failed",
    );
  });

  it("redacts email addresses", () => {
    expect(redactText("duplicate key (email)=(ada.lovelace+test@example.co.uk)")).toBe(
      `duplicate key (email)=(${REDACTED})`,
    );
  });

  it("leaves plain text alone", () => {
    expect(redactText("Cannot read properties of undefined")).toBe(
      "Cannot read properties of undefined",
    );
  });
});

describe("stripQuery", () => {
  it("removes query and fragment from URLs and paths", () => {
    expect(stripQuery("/takes/abc?sort=new#top")).toBe("/takes/abc");
    expect(stripQuery("https://x.dev/a")).toBe("https://x.dev/a");
  });
});

describe("scrubEvent", () => {
  const event = {
    event_id: "e1",
    message: `Upload to ${presigned} failed for ada@example.com`,
    exception: {
      values: [{ type: "Error", value: `Render failed: ${presigned}` }],
    },
    request: {
      url: "https://take-studio.dev/api/takes?title=My%20holiday",
      method: "POST",
      data: { title: "My holiday", fileName: "holiday.mov" },
      cookies: { "better-auth.session_token": "abc.def" },
      query_string: "title=My%20holiday",
      headers: {
        Authorization: "Bearer secret",
        Cookie: "better-auth.session_token=abc.def",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    },
    user: { id: "user_123", email: "ada@example.com", ip_address: "203.0.113.9", username: "ada" },
    extra: { takeId: "take_1", title: "My holiday", fileName: "holiday.mov", transcript: "hello" },
    tags: { runtime: "web", note: `see ${presigned}` },
    contexts: { response: { body: `link ${presignedOtherHost}` } },
    breadcrumbs: [
      {
        category: "fetch",
        data: { method: "PUT", url: presigned, status_code: 403, request_body_size: 10 },
      },
      { category: "console", message: "signed in as ada@example.com" },
      { category: "navigation", data: { from: "/takes?q=holiday", to: "/takes/abc?tab=cuts" } },
    ],
  };
  const scrubbed = scrubEvent(event);
  const serialised = JSON.stringify(scrubbed);

  it("removes the request body, cookies, query string and secret headers", () => {
    expect(scrubbed.request).toEqual({
      url: "https://take-studio.dev/api/takes",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("keeps only the user id", () => {
    expect(scrubbed.user).toEqual({ id: "user_123" });
  });

  it("keeps only allowlisted extra keys", () => {
    expect(scrubbed.extra).toEqual({ takeId: "take_1" });
  });

  it("redacts presigned URLs and emails in messages, exceptions, tags and contexts", () => {
    expect(scrubbed.message).toBe(`Upload to ${REDACTED} failed for ${REDACTED}`);
    expect(scrubbed.exception.values[0]!.value).toBe(`Render failed: ${REDACTED}`);
    expect(scrubbed.tags).toEqual({ runtime: "web", note: `see ${REDACTED}` });
  });

  it("scrubs breadcrumbs", () => {
    expect(scrubbed.breadcrumbs[0]).toEqual({
      category: "fetch",
      data: { method: "PUT", url: REDACTED, status_code: 403 },
    });
    expect(scrubbed.breadcrumbs[1]!.message).toBe(`signed in as ${REDACTED}`);
    expect(scrubbed.breadcrumbs[2]!.data).toEqual({ from: "/takes", to: "/takes/abc" });
  });

  it("leaves nothing personal or secret anywhere in the event", () => {
    for (const leak of [
      "ada@example.com",
      "X-Amz",
      "r2.cloudflarestorage.com",
      "My holiday",
      "holiday.mov",
      "abc.def",
      "Bearer secret",
      "203.0.113.9",
      "hello",
    ]) {
      expect(serialised).not.toContain(leak);
    }
  });

  it("does not change the input", () => {
    expect(event.user.email).toBe("ada@example.com");
  });
});

describe("scrubBreadcrumb", () => {
  it("passes a breadcrumb without data through", () => {
    expect(scrubBreadcrumb({ category: "ui.click", message: "button.primary" })).toEqual({
      category: "ui.click",
      message: "button.primary",
    });
  });
});

describe("jobTagsFrom", () => {
  it("picks only takeId, jobId and renderId", () => {
    expect(
      jobTagsFrom({
        takeId: "take_1",
        jobId: "job-2",
        renderId: "r3",
        title: "My holiday",
        url: presigned,
        userEmail: "ada@example.com",
      }),
    ).toEqual({ takeId: "take_1", jobId: "job-2", renderId: "r3" });
  });

  it("ignores values that are not short ID strings", () => {
    expect(jobTagsFrom({ takeId: "x".repeat(65), jobId: 42, renderId: "a b" })).toEqual({});
  });

  it("handles payloads that are not objects", () => {
    expect(jobTagsFrom(undefined)).toEqual({});
    expect(jobTagsFrom("take_1")).toEqual({});
  });
});
