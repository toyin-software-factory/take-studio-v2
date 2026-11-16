import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_PNG_PATH, isUsableCreditPng } from "@/lib/credit-filter";
import { MediaToolError } from "../media";
import { creditedEncodeMayRetryClean } from "./credit";

// Spec 0026 AC-10.
describe("creditedEncodeMayRetryClean", () => {
  it("retries a non zero ffmpeg exit and the credited encode's own cap", () => {
    expect(creditedEncodeMayRetryClean(new MediaToolError("ffmpeg", 1, false))).toBe(true);
    expect(creditedEncodeMayRetryClean(new MediaToolError("ffmpeg", null, true))).toBe(true);
  });
  it("never retries an abort or the job deadline", () => {
    expect(creditedEncodeMayRetryClean(new Error("aborted"))).toBe(false);
    expect(creditedEncodeMayRetryClean(new DOMException("deadline", "AbortError"))).toBe(false);
    expect(creditedEncodeMayRetryClean(new MediaToolError("ffprobe", 1, false))).toBe(false);
  });
});

describe("isUsableCreditPng", () => {
  it("accepts the committed image and refuses damaged or empty files", () => {
    const png = new Uint8Array(readFileSync(CREDIT_PNG_PATH));
    expect(isUsableCreditPng(png)).toBe(true);
    expect(isUsableCreditPng(png.slice(0, 20))).toBe(false);
    expect(isUsableCreditPng(new Uint8Array())).toBe(false);
    const wrong = png.slice();
    wrong[0] = 0;
    expect(isUsableCreditPng(wrong)).toBe(false);
  });
});
