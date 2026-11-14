import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { needsPacketEnd, parseFfprobe, parsePacketEnd, parseRate, thumbnailSeconds } from "./probe";
import { uploadFailureMessage } from "./take-messages";
import { checkUpload } from "./take-rules";

/** Real ffprobe JSON for the committed fixtures (tests/fixtures/make-media.sh). */
function fixture(name: string): unknown {
  const url = new URL(`../../tests/fixtures/media/${name}.ffprobe.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

describe("parseFfprobe on real fixtures (AC-4, AC-6)", () => {
  it("reads a normal landscape MP4", () => {
    expect(parseFfprobe(fixture("normal"))).toEqual({
      durationMs: 6_000,
      width: 640,
      height: 360,
      container: "mp4",
      hasAudio: true,
      fps: 30,
      hdrTransfer: null,
    });
  });

  it("applies the display rotation of a portrait phone MOV (moov at the end)", () => {
    expect(parseFfprobe(fixture("portrait-moov-end"))).toMatchObject({
      width: 720,
      height: 1280,
      container: "mov",
      hasAudio: true,
    });
  });

  it("reports the PQ transfer of an HDR clip", () => {
    expect(parseFfprobe(fixture("hdr-pq"))).toMatchObject({ hdrTransfer: "smpte2084" });
  });

  it("notices a clip with no audio", () => {
    expect(parseFfprobe(fixture("silent"))).toMatchObject({ hasAudio: false });
  });

  it.each([
    ["normal", { ok: true }],
    ["portrait-moov-end", { ok: true }],
    ["hdr-pq", { ok: true }],
    ["silent", { ok: true }],
    ["too-long-11min", { ok: false, failureCode: "too_long" }],
    ["4k", { ok: false, failureCode: "resolution_exceeded" }],
  ] as const)("%s ends in the right upload verdict", (name, expected) => {
    expect(checkUpload(1_000_000, parseFfprobe(fixture(name)))).toMatchObject(expected);
  });
});

describe("parseFfprobe edges", () => {
  it("returns null with no video stream, no size or no duration", () => {
    expect(
      parseFfprobe({ streams: [{ codec_type: "audio" }], format: { duration: "3" } }),
    ).toBeNull();
    expect(
      parseFfprobe({ streams: [{ codec_type: "video", width: 0, height: 0 }], format: {} }),
    ).toBeNull();
    expect(
      parseFfprobe({ streams: [{ codec_type: "video", width: 10, height: 10 }], format: {} }),
    ).toBeNull();
    expect(parseFfprobe("not json")).toBeNull();
  });

  it("ignores cover art and reads the legacy rotate tag and HLG", () => {
    const facts = parseFfprobe({
      streams: [
        { codec_type: "video", width: 300, height: 300, disposition: { attached_pic: 1 } },
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          tags: { rotate: "270" },
          color_transfer: "arib-std-b67",
          avg_frame_rate: "0/0",
          r_frame_rate: "30000/1001",
        },
      ],
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.3456" },
    });
    expect(facts).toMatchObject({
      width: 1080,
      height: 1920,
      durationMs: 12_346,
      fps: 29.97,
      hdrTransfer: "arib-std-b67",
      hasAudio: false,
    });
  });

  it("marks a container that is not MP4, MOV or WebM so the upload is refused as invalid media", () => {
    const facts = parseFfprobe({
      streams: [{ codec_type: "video", width: 640, height: 360 }],
      format: { format_name: "avi", duration: "3" },
    });
    expect(checkUpload(1, facts)).toEqual({ ok: false, failureCode: "invalid_media" });
  });

  it("parses frame rates", () => {
    expect(parseRate("30000/1001")).toBe(29.97);
    expect(parseRate("25/1")).toBe(25);
    expect(parseRate("0/0")).toBeNull();
    expect(parseRate(undefined)).toBeNull();
  });

  it("takes the thumbnail 1 s in, or at the start for clips of 2 s or less", () => {
    expect(thumbnailSeconds(6_000)).toBe(1);
    expect(thumbnailSeconds(2_000)).toBe(0);
  });
});

describe("upload failure messages (AC-4)", () => {
  const base = { durationMs: null, width: null, height: null, originalBytes: 1 };
  it("names the problem and the limit", () => {
    expect(
      uploadFailureMessage({ ...base, failureCode: "too_long", durationMs: 14 * 60_000 }),
    ).toBe("This video is 14 minutes long. The limit is 10 minutes.");
    expect(uploadFailureMessage({ ...base, failureCode: "too_long", durationMs: 660_500 })).toBe(
      "This video is 12 minutes long. The limit is 10 minutes.",
    );
    expect(
      uploadFailureMessage({
        ...base,
        failureCode: "resolution_exceeded",
        width: 3840,
        height: 2160,
      }),
    ).toBe("This video is 3840×2160. The limit is 1080p (1920×1080).");
    expect(uploadFailureMessage({ ...base, failureCode: "corrupt_upload" })).toContain(
      "couldn't be read",
    );
    expect(uploadFailureMessage({ ...base, failureCode: "something_new" })).toBe(
      "Something went wrong with this video.",
    );
  });
});

describe("WebM from a browser (spec 0021)", () => {
  const webm = {
    streams: [
      { codec_type: "video", width: 1280, height: 720, avg_frame_rate: "30/1" },
      { codec_type: "audio" },
    ],
    format: { format_name: "matroska,webm", size: "12345" },
  };

  it("reads the container as webm and the length from the last packet, not the header", () => {
    expect(needsPacketEnd(webm)).toBe(true);
    const facts = parseFfprobe(webm, { packetEndSeconds: 12.5 });
    expect(facts).toMatchObject({ container: "webm", durationMs: 12_500, hasAudio: true });
    // No header duration and no packets: no usable length, so the take fails as corrupt.
    expect(parseFfprobe(webm)).toBeNull();
    expect(parseFfprobe(webm, { packetEndSeconds: null })).toBeNull();
  });

  it("does not ask for packets for an MP4", () => {
    const mp4 = { ...webm, format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", size: "1" } };
    expect(needsPacketEnd(mp4)).toBe(false);
    expect(needsPacketEnd("nope")).toBe(false);
  });

  it("takes the largest packet end and skips N/A and empty lines", () => {
    expect(
      parsePacketEnd("0.000000,0.033000\nN/A,N/A\n\n1.000000,0.033000\n0.500000,\n"),
    ).toBeCloseTo(1.033);
    expect(parsePacketEnd("2.5,N/A")).toBe(2.5);
    expect(parsePacketEnd("")).toBeNull();
    expect(parsePacketEnd("N/A,N/A")).toBeNull();
  });
});
