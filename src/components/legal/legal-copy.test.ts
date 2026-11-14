import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETE_EMAIL_DAYS,
  ACCOUNT_DELETE_SELF_SERVE,
  LEGAL_NUMBERS,
  LEGAL_VERSION,
  MINIMUM_AGE,
  PROCESSORS,
} from "@/lib/legal-facts";
import { latestRecorded, recordedHash } from "@/lib/legal-text-hashes";
import { legalCopyHash, legalCopyText } from "./legal-text";

/** Spec 0015 AC-3, AC-5, AC-6, AC-7, AC-9, AC-13: the copy says what the facts file says. */
describe("the Privacy copy", () => {
  const text = legalCopyText("privacy");

  it("quotes the retention, upload limits and account deletion from the facts (AC-3, AC-13)", () => {
    expect(text).toContain(`kept for ${LEGAL_NUMBERS.retentionDays} days`);
    expect(text).toContain(`${LEGAL_NUMBERS.maxMinutes} minutes of video`);
    expect(text).toContain(`${LEGAL_NUMBERS.maxGigabytes} GB per file`);
    expect(text).toContain("any take at any time");
    expect(text).toContain("keyed hash of your email");
    expect(text).toContain(
      ACCOUNT_DELETE_SELF_SERVE ? "from the account menu" : "To delete your account, email",
    );
    if (!ACCOUNT_DELETE_SELF_SERVE)
      expect(text).toContain(`within ${ACCOUNT_DELETE_EMAIL_DAYS} days`);
  });

  it("names every processor and what it receives (AC-4)", () => {
    for (const p of PROCESSORS) {
      expect(text).toContain(p.name);
      expect(text).toContain(p.receives);
    }
    expect(text).toContain("We do not sell your data");
    expect(text).toContain("not to use your audio to train");
    expect(text).toContain("never your video or your audio");
  });

  it("names the one cookie and says there is no analytics or advertising cookie (AC-5)", () => {
    expect(text).toContain("better-auth.session_token");
    expect(text).toContain("no advertising cookie and no analytics cookie");
  });

  it("states all three allowance wordings, the minutes as a token (AC-9)", () => {
    expect(text).toContain("Free accounts get {minutes} minutes");
    expect(text).toContain("There is no monthly limit for now");
    expect(text).toContain("temporarily unavailable");
  });
});

describe("the Terms copy", () => {
  const text = legalCopyText("terms");
  it("covers the age floor, ownership, the 30 day rule and liability (AC-6)", () => {
    expect(text).toContain(`at least ${MINIMUM_AGE} years old`);
    expect(text).toContain("You keep all rights in your videos, transcripts and scripts");
    expect(text).toContain(`${LEGAL_NUMBERS.retentionDays} days`);
    expect(text).toContain("not liable");
    expect(text).toContain("do not promise it will always be available");
  });
  it("shows no governing law or date that was not supplied", () => {
    // With the template entity every field is set; the null case is checked on the entity itself.
    expect(text).toContain("governed by the law of {governing law}");
  });
});

describe("the recorded text hashes (AC-7, AC-9)", () => {
  for (const page of ["privacy", "terms"] as const) {
    it(`${page}: the copy's hash is the newest recorded line, under the current version date`, async () => {
      expect(LEGAL_VERSION[page]).toBe(latestRecorded(page)?.date);
      expect(await legalCopyHash(page)).toBe(recordedHash(page, LEGAL_VERSION[page]));
    });
  }
});
