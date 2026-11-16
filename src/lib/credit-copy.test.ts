import { describe, expect, it } from "vitest";
import { CREDIT_LINE, creditNote } from "./credit-copy";

describe("creditNote", () => {
  it("says the credit is there on a credited free video", () => {
    expect(creditNote({ applied: true, canChange: false }, false)).toEqual({
      text: CREDIT_LINE,
      paid: null,
    });
  });
  it("says nothing when the stored video has no credit", () => {
    expect(creditNote({ applied: false, canChange: false }, false)).toBeNull();
  });
  it("leaves the paid creator's line to the switch", () => {
    expect(creditNote({ applied: true, canChange: true }, true)).toBeNull();
  });
  it("mentions a paid plan only when removal is live", () => {
    expect(creditNote({ applied: true, canChange: false }, false)?.paid).toBeNull();
    expect(creditNote({ applied: true, canChange: false }, true)?.paid).toBe(
      "Paid plans can remove it.",
    );
  });
  it("has no dash punctuation and no web address", () => {
    expect(CREDIT_LINE).not.toMatch(/[—–]| - |https?:|\.com/);
  });
});
