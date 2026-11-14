import { describe, expect, it } from "vitest";
import { ORIGINAL_INPUT, WEBM_INPUT, originalInput } from "./ffmpeg-input";

describe("originalInput (spec 0021)", () => {
  it("pins MP4 and MOV originals as before", () => {
    expect(originalInput("/tmp/originals/a/source.mp4")).toEqual(ORIGINAL_INPUT);
    expect(originalInput("originals/a/source.mov")).toEqual(ORIGINAL_INPUT);
  });

  it("pins a WebM original as matroska, also behind a presigned query", () => {
    expect(originalInput("/tmp/source.webm")).toEqual(WEBM_INPUT);
    expect(
      originalInput("https://r2.example/originals/a/source.webm?X-Amz-Signature=abc#x"),
    ).toEqual(WEBM_INPUT);
  });

  it("is not fooled by .webm in the query or the host", () => {
    expect(originalInput("https://r2.example/originals/a/source.mp4?name=x.webm")).toEqual(
      ORIGINAL_INPUT,
    );
  });
});
