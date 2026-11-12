import { describe, expect, it } from "vitest";
import { DeadlineExceeded } from "@/lib/deadline";
import { BackgroundMissingError } from "./keying";
import { MediaToolError } from "./media";
import { failureCodeFor } from "./process-take";

describe("failureCodeFor (spec 0004 Flow step 5)", () => {
  it("maps ffmpeg and ffprobe failures to ffmpeg_error", () => {
    expect(failureCodeFor(new MediaToolError("ffmpeg", 1, false))).toBe("ffmpeg_error");
    expect(failureCodeFor({ name: "MediaToolError", message: "ffprobe failed (exit 1)" })).toBe(
      "ffmpeg_error",
    );
  });

  it("maps a run past maxDuration to timeout", () => {
    expect(failureCodeFor({ name: "Error", message: "MAX_DURATION_EXCEEDED" })).toBe("timeout");
    expect(failureCodeFor(new Error("Run exceeded maxDuration of 2400 seconds"))).toBe("timeout");
  });

  it("maps a run that stopped itself before maxDuration to timeout, ahead of any tool error", () => {
    expect(failureCodeFor(new DeadlineExceeded())).toBe("timeout");
    expect(failureCodeFor({ name: "DeadlineExceeded", message: "x" })).toBe("timeout");
  });

  it("maps a missing background to background_missing", () => {
    expect(failureCodeFor(new BackgroundMissingError())).toBe("background_missing");
    expect(failureCodeFor({ name: "BackgroundMissingError", message: "x" })).toBe(
      "background_missing",
    );
  });

  it("maps anything else (download, upload, database) to internal_error", () => {
    expect(failureCodeFor(new Error("R2 download failed: HTTP 500"))).toBe("internal_error");
    expect(failureCodeFor(undefined)).toBe("internal_error");
  });
});
