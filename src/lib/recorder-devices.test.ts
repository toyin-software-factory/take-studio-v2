import { describe, expect, it } from "vitest";
import {
  deviceChoices,
  interruptionNote,
  interruptionReason,
  levelLabel,
  levelOf,
  litSegments,
  nextCameraId,
  offersNativeCamera,
  setupProblem,
  shouldRelockOnVisible,
  stillAvailable,
  type BrowserSupport,
} from "./recorder-devices";
import { SETUP_MESSAGES, classifyMediaError } from "./recorder-rules";

const fine: BrowserSupport = {
  secure: true,
  hasGetUserMedia: true,
  hasMediaRecorder: true,
  hasRecordableType: true,
};

describe("setupProblem (AC-5)", () => {
  it("allows a secure browser that can record", () => expect(setupProblem(fine)).toBeNull());
  it("names an insecure page first", () =>
    expect(setupProblem({ ...fine, secure: false, hasMediaRecorder: false })).toBe("insecure"));
  it("names a browser without recording", () => {
    expect(setupProblem({ ...fine, hasMediaRecorder: false })).toBe("unsupported");
    expect(setupProblem({ ...fine, hasGetUserMedia: false })).toBe("unsupported");
    expect(setupProblem({ ...fine, hasRecordableType: false })).toBe("unsupported");
  });
});

describe("every failure has its own plain message (AC-5)", () => {
  it("maps each error name to a distinct failure with a message", () => {
    const names = ["NotAllowedError", "NotFoundError", "NotReadableError", "TypeError"].map(
      classifyMediaError,
    );
    expect(new Set([...names, "insecure"]).size).toBe(5);
    for (const failure of [...names, "insecure" as const]) {
      expect(SETUP_MESSAGES[failure].title.length).toBeGreaterThan(5);
      expect(SETUP_MESSAGES[failure].body.length).toBeGreaterThan(20);
    }
  });
});

describe("offersNativeCamera", () => {
  it("offers it on a phone without recording or on an insecure page", () => {
    expect(offersNativeCamera("unsupported", true)).toBe(true);
    expect(offersNativeCamera("insecure", true)).toBe(true);
  });
  it("not on a desktop, and not for a denied camera", () => {
    expect(offersNativeCamera("unsupported", false)).toBe(false);
    expect(offersNativeCamera("denied", true)).toBe(false);
    expect(offersNativeCamera(null, true)).toBe(false);
  });
});

describe("deviceChoices and flip", () => {
  const devices = [
    { deviceId: "c1", kind: "videoinput", label: "Front" },
    { deviceId: "c2", kind: "videoinput", label: "" },
    { deviceId: "m1", kind: "audioinput", label: "Built in" },
    { deviceId: "", kind: "audioinput", label: "" },
    { deviceId: "s1", kind: "audiooutput", label: "Speaker" },
  ] as const;
  const { cameras, microphones } = deviceChoices(devices);
  it("splits cameras and microphones, labels the unlabelled, drops empty ids", () => {
    expect(cameras).toEqual([
      { id: "c1", label: "Front" },
      { id: "c2", label: "Camera 2" },
    ]);
    expect(microphones).toEqual([{ id: "m1", label: "Built in" }]);
  });
  it("flips to the next camera and wraps", () => {
    expect(nextCameraId(cameras, "c1")).toBe("c2");
    expect(nextCameraId(cameras, "c2")).toBe("c1");
    expect(nextCameraId(cameras, null)).toBe("c2");
  });
  it("has nothing to flip to with one camera", () =>
    expect(nextCameraId(cameras.slice(0, 1), "c1")).toBeNull());
  it("forgets a device that was unplugged", () => {
    expect(stillAvailable(cameras, "c2")).toBe("c2");
    expect(stillAvailable(cameras, "gone")).toBeNull();
    expect(stillAvailable(cameras, null)).toBeNull();
  });
});

describe("level meter (AC-9 text alternative)", () => {
  it("reads silence as 0 and a loud signal near 1", () => {
    expect(levelOf(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelOf(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0)))).toBe(1);
    expect(levelOf([])).toBe(0);
  });
  it("lights segments in proportion and stays in range", () => {
    expect(litSegments(0)).toBe(0);
    expect(litSegments(0.5)).toBe(6);
    expect(litSegments(5)).toBe(12);
    expect(litSegments(-1)).toBe(0);
  });
  it("words the level", () => {
    expect(levelLabel(0)).toBe("No sound yet");
    expect(levelLabel(0.1)).toBe("Quiet");
    expect(levelLabel(0.5)).toBe("Good");
    expect(levelLabel(0.95)).toBe("Too loud");
  });
});

describe("interruptions (AC-7)", () => {
  it("tells a lost device from a background stop", () => {
    expect(interruptionReason({ wasHidden: true, trackEnded: true })).toBe("device_lost");
    expect(interruptionReason({ wasHidden: true, trackEnded: false })).toBe("background");
    expect(interruptionReason({ wasHidden: false, trackEnded: false })).toBe("unknown");
  });
  it("has a note for each reason that says the capture is kept", () => {
    for (const r of ["background", "device_lost", "unknown"] as const) {
      expect(interruptionNote(r)).toContain("What was captured is below");
    }
  });
  it("asks for the wake lock again only when visible and recording", () => {
    expect(shouldRelockOnVisible(true, "visible")).toBe(true);
    expect(shouldRelockOnVisible(true, "hidden")).toBe(false);
    expect(shouldRelockOnVisible(false, "visible")).toBe(false);
  });
});
