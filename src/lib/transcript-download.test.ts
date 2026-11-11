import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  downloadBody,
  downloadFormatSchema,
  downloadHeaders,
} from "./transcript-download";
import type { TrimmedParagraph } from "./transcript-timeline";

const paragraphs: TrimmedParagraph[] = [
  {
    startMs: 0,
    words: [
      { w: "Um", startMs: 0, endMs: 200, filler: true },
      { w: "Hello.", startMs: 200, endMs: 800, filler: false },
    ],
  },
];

describe("downloadFormatSchema", () => {
  it("accepts txt, srt and vtt only", () => {
    expect(downloadFormatSchema.safeParse("txt").success).toBe(true);
    expect(downloadFormatSchema.safeParse("srt").success).toBe(true);
    expect(downloadFormatSchema.safeParse("vtt").success).toBe(true);
    for (const bad of ["pdf", "TXT", "", "srt.txt", "../x"]) {
      expect(downloadFormatSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("downloadHeaders", () => {
  it("sets the type, no store and nosniff for each format", () => {
    expect(downloadHeaders("txt", "Take")["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(downloadHeaders("srt", "Take")["Content-Type"]).toContain("application/x-subrip");
    expect(downloadHeaders("vtt", "Take")["Content-Type"]).toContain("text/vtt");
    for (const f of ["txt", "srt", "vtt"] as const) {
      expect(downloadHeaders(f, "Take")["Cache-Control"]).toBe("private, no-store");
      expect(downloadHeaders(f, "Take")["X-Content-Type-Options"]).toBe("nosniff");
    }
  });

  it("saves the text and the SRT, and shows the WebVTT inline", () => {
    expect(contentDisposition("txt", "Take")).toMatch(/^attachment;/);
    expect(contentDisposition("srt", "Take")).toMatch(/^attachment;/);
    expect(contentDisposition("vtt", "Take")).toMatch(/^inline;/);
  });
});

describe("contentDisposition file names", () => {
  it("names the file after the take", () => {
    expect(contentDisposition("srt", "My interview")).toBe(
      `attachment; filename="My interview.srt"; filename*=UTF-8''My%20interview.srt`,
    );
  });

  it("gives an ASCII filename and the full name in filename*", () => {
    const value = contentDisposition("txt", "Café Résumé 🎬");
    expect(value).toContain('filename="Cafe Resume.txt"');
    expect(value).toContain("filename*=UTF-8''Caf%C3%A9%20R%C3%A9sum%C3%A9%20%F0%9F%8E%AC.txt");
    // The plain filename part is ASCII only.
    const plain = /filename="([^"]*)"/.exec(value)?.[1] ?? "";
    expect(plain).toMatch(/^[\x20-\x7e]+$/);
  });

  it("removes quotes, slashes and control characters so the header cannot be broken", () => {
    const value = contentDisposition("srt", 'a"b/c\\d\r\ne;f\u0000');
    expect(value).not.toMatch(/[\r\n\u0000]/);
    expect(value.match(/"/g)).toHaveLength(2); // only the quotes around filename
    expect(value).not.toContain("/");
    expect(value).not.toContain("\\");
  });

  it("encodes the characters that RFC 5987 does not allow", () => {
    expect(contentDisposition("txt", "it's (v2)")).toContain("it%27s%20%28v2%29.txt");
  });

  it("falls back to take for an empty or unusable title", () => {
    expect(contentDisposition("txt", "")).toContain('filename="take.txt"');
    expect(contentDisposition("txt", "   ")).toContain('filename="take.txt"');
    expect(contentDisposition("txt", "🎬🎬")).toContain("filename*=UTF-8''%F0%9F%8E%AC");
    expect(contentDisposition("txt", "🎬🎬")).toContain('filename="take.txt"');
  });

  it("cuts a very long title to 200 characters", () => {
    const value = contentDisposition("srt", "a".repeat(500));
    expect(value).toContain(`filename="${"a".repeat(200)}.srt"`);
  });
});

describe("downloadBody", () => {
  it("makes the text, SRT and VTT bodies from the same words", () => {
    expect(downloadBody("txt", paragraphs)).toBe("Hello.\n");
    expect(downloadBody("srt", paragraphs)).toBe("1\n00:00:00,200 --> 00:00:01,200\nHello.\n\n");
    expect(downloadBody("vtt", paragraphs)).toBe(
      "WEBVTT\n\n00:00:00.200 --> 00:00:01.200\nHello.\n\n",
    );
  });

  it("is null when there are no kept words that are not fillers", () => {
    expect(downloadBody("txt", [])).toBeNull();
    const fillersOnly: TrimmedParagraph[] = [
      { startMs: 0, words: [{ w: "um", startMs: 0, endMs: 200, filler: true }] },
    ];
    for (const f of ["txt", "srt", "vtt"] as const) expect(downloadBody(f, fillersOnly)).toBeNull();
  });
});
