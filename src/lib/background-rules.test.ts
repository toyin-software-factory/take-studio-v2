import { describe, expect, it } from "vitest";
import {
  BACKGROUND_FAILURE_MESSAGES,
  backgroundFailureMessage,
  backgroundKeys,
  checkImageFacts,
  displaySize,
  isAnimatedWebp,
  isBackgroundContentType,
  rotationFilter,
} from "./background-rules";

const ok = { codec: "mjpeg", width: 1920, height: 1080, frames: 1, rotation: 0, format: "image2" };

describe("checkImageFacts (AC-8)", () => {
  it("accepts a still JPEG, PNG or WebP of at least 1280 by 720 and at most 40 megapixels", () => {
    for (const codec of ["mjpeg", "png", "webp"])
      expect(checkImageFacts({ ...ok, codec })).toBeNull();
    expect(checkImageFacts({ ...ok, width: 1280, height: 720 })).toBeNull();
    expect(checkImageFacts({ ...ok, width: 8000, height: 5000 })).toBeNull(); // exactly 40 MP
  });

  it("refuses other formats as image_invalid and animated ones as image_animated", () => {
    for (const codec of ["gif", "bmp", "tiff", "h264", "svg"]) {
      expect(checkImageFacts({ ...ok, codec })).toBe("image_invalid");
    }
    expect(checkImageFacts({ ...ok, codec: "apng" })).toBe("image_animated");
    expect(checkImageFacts({ ...ok, frames: 2 })).toBe("image_animated");
  });

  it("refuses a video container even when its codec is MJPEG, PNG or WebP", () => {
    for (const format of ["avi", "mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm", "mpjpeg", ""]) {
      expect(checkImageFacts({ ...ok, format })).toBe("image_invalid");
    }
    for (const [codec, format] of [
      ["png", "png_pipe"],
      ["webp", "webp_pipe"],
      ["mjpeg", "jpeg_pipe"],
    ] as const) {
      expect(checkImageFacts({ ...ok, codec, format })).toBeNull();
    }
  });

  it("refuses over 40 megapixels as image_too_large, before the size check", () => {
    expect(checkImageFacts({ ...ok, width: 8001, height: 5000 })).toBe("image_too_large");
  });

  it("refuses under 1280 by 720 as image_too_small, on the size as displayed", () => {
    expect(checkImageFacts({ ...ok, width: 1279, height: 720 })).toBe("image_too_small");
    expect(checkImageFacts({ ...ok, width: 1280, height: 719 })).toBe("image_too_small");
    // 1280 by 800 passes, but turned a quarter it displays 800 by 1280.
    expect(checkImageFacts({ ...ok, width: 1280, height: 800 })).toBeNull();
    expect(checkImageFacts({ ...ok, width: 1280, height: 800, rotation: -90 })).toBe(
      "image_too_small",
    );
  });

  it("refuses an image with no size", () => {
    expect(checkImageFacts({ ...ok, width: 0, height: 0 })).toBe("image_invalid");
  });
});

describe("displaySize and rotationFilter", () => {
  it("swaps the sides for a quarter turn only", () => {
    expect(displaySize({ width: 4, height: 3, rotation: 0 })).toEqual({ width: 4, height: 3 });
    expect(displaySize({ width: 4, height: 3, rotation: 90 })).toEqual({ width: 3, height: 4 });
    expect(displaySize({ width: 4, height: 3, rotation: -90 })).toEqual({ width: 3, height: 4 });
    expect(displaySize({ width: 4, height: 3, rotation: 180 })).toEqual({ width: 4, height: 3 });
  });

  it("turns each rotation upright", () => {
    expect(rotationFilter(0)).toBe("");
    expect(rotationFilter(-90)).toBe("transpose=clock,");
    expect(rotationFilter(270)).toBe("transpose=clock,");
    expect(rotationFilter(90)).toBe("transpose=cclock,");
    expect(rotationFilter(180)).toBe("hflip,vflip,");
    expect(rotationFilter(-180)).toBe("hflip,vflip,");
  });
});

describe("isAnimatedWebp", () => {
  const webp = (flags: number, chunk = "VP8X") => {
    const head = new Uint8Array(30);
    head.set(Buffer.from("RIFF"), 0);
    head.set(Buffer.from("WEBP"), 8);
    head.set(Buffer.from(chunk), 12);
    head[20] = flags;
    return head;
  };

  it("is true only for a VP8X container with the animation bit", () => {
    expect(isAnimatedWebp(webp(0x02))).toBe(true);
    expect(isAnimatedWebp(webp(0x12))).toBe(true);
    expect(isAnimatedWebp(webp(0x10))).toBe(false);
    expect(isAnimatedWebp(webp(0x02, "VP8 "))).toBe(false);
    expect(isAnimatedWebp(new Uint8Array(10))).toBe(false);
    expect(isAnimatedWebp(Buffer.from("not an image at all, just some text"))).toBe(false);
  });
});

describe("keys, types and messages", () => {
  it("keeps the three files under the creator and the background", () => {
    expect(backgroundKeys("u1", "b1")).toEqual({
      sourceKey: "backgrounds/u1/b1/source",
      imageKey: "backgrounds/u1/b1/image.jpg",
      thumbKey: "backgrounds/u1/b1/thumb.webp",
    });
  });

  it("knows the three content types and nothing else", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"])
      expect(isBackgroundContentType(type)).toBe(true);
    for (const type of ["image/gif", "image/svg+xml", "IMAGE/JPEG", "", "text/plain"]) {
      expect(isBackgroundContentType(type)).toBe(false);
    }
  });

  it("has a friendly message for every code, and a safe one for an unknown or missing code", () => {
    for (const message of Object.values(BACKGROUND_FAILURE_MESSAGES)) {
      expect(message).toMatch(/^[A-Z]/);
      expect(message).not.toMatch(/image_|_error|exit/);
    }
    expect(backgroundFailureMessage("image_too_small")).toContain("1280 by 720");
    expect(backgroundFailureMessage("image_too_large")).toContain("10 MB");
    expect(backgroundFailureMessage("nonsense")).toBe(BACKGROUND_FAILURE_MESSAGES.ingest_error);
    expect(backgroundFailureMessage(null)).toBe(BACKGROUND_FAILURE_MESSAGES.ingest_error);
    for (const code of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(backgroundFailureMessage(code)).toBe(BACKGROUND_FAILURE_MESSAGES.ingest_error);
    }
  });
});
