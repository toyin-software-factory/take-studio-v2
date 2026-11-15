import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireMedia,
  checkBrowser,
  createRecorder,
  finishedAction,
  idsOf,
  keepAwake,
  openMedia,
  openWithFallback,
} from "./recorder-media";

// The browser side of the recorder (spec 0021 AC-1, AC-5, AC-7): what is asked of the camera,
// what happens when a remembered device is gone, and what a finished recording becomes.
// Synthetic streams only; the real camera is the e2e specs' job (tests/record*.spec.ts).

afterEach(() => vi.unstubAllGlobals());

type Track = { stop: ReturnType<typeof vi.fn>; getSettings: () => { deviceId?: string } };
const track = (deviceId?: string): Track => ({
  stop: vi.fn(),
  getSettings: () => ({ deviceId }),
});
function streamOf(video: Track[], audio: Track[] = []) {
  return {
    getTracks: () => [...video, ...audio],
    getVideoTracks: () => video,
    getAudioTracks: () => audio,
  } as unknown as MediaStream;
}
const fail = (name: string) => Object.assign(new Error(name), { name });
function stubMedia(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

describe("openMedia", () => {
  it("asks for the front camera by default and an exact device when one is chosen (AC-1)", async () => {
    const asked: MediaStreamConstraints[] = [];
    stubMedia(async (c) => (asked.push(c), streamOf([])));
    await openMedia(null, null);
    await openMedia("cam-2", "mic-2");
    expect(asked[0]?.video).toMatchObject({ facingMode: "user" });
    expect(asked[0]?.audio).toBe(true);
    expect(asked[1]?.video).toMatchObject({ deviceId: { exact: "cam-2" } });
    expect(asked[1]?.video).not.toHaveProperty("facingMode");
    expect(asked[1]?.audio).toEqual({ deviceId: { exact: "mic-2" } });
  });
});

describe("openWithFallback", () => {
  it("tries the browser's defaults when a remembered device is gone", async () => {
    const asked: MediaStreamConstraints[] = [];
    const ok = streamOf([track("default")]);
    stubMedia(async (c) => {
      asked.push(c);
      if (asked.length === 1) throw fail("OverconstrainedError");
      return ok;
    });
    await expect(openWithFallback("unplugged", "mic")).resolves.toBe(ok);
    expect(asked).toHaveLength(2);
    expect(asked[1]?.audio).toBe(true);
  });

  it("does not retry a refusal, or when no device was chosen (the first answer stands)", async () => {
    const asked = vi.fn(async () => {
      throw fail("NotAllowedError");
    });
    stubMedia(asked);
    await expect(openWithFallback("cam", null)).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(asked).toHaveBeenCalledTimes(1);

    const none = vi.fn(async () => {
      throw fail("NotFoundError");
    });
    stubMedia(none);
    await expect(openWithFallback(null, null)).rejects.toMatchObject({ name: "NotFoundError" });
    expect(none).toHaveBeenCalledTimes(1);
  });

  it("gives up with the second error when the defaults fail too", async () => {
    let n = 0;
    stubMedia(async () => {
      throw fail(++n === 1 ? "NotFoundError" : "NotReadableError");
    });
    await expect(openWithFallback("cam", "mic")).rejects.toMatchObject({
      name: "NotReadableError",
    });
  });
});

describe("acquireMedia: nothing may keep the camera on (AC-5)", () => {
  it("lets every track go when the page was left while the browser was asking", async () => {
    const video = track("c");
    const audio = track("m");
    stubMedia(async () => streamOf([video], [audio]));
    await expect(acquireMedia(null, null, () => false)).resolves.toBeNull();
    expect(video.stop).toHaveBeenCalledTimes(1);
    expect(audio.stop).toHaveBeenCalledTimes(1);
  });

  it("hands the stream over, untouched, while the page is still there", async () => {
    const video = track("c");
    const media = streamOf([video]);
    stubMedia(async () => media);
    await expect(acquireMedia(null, null, () => true)).resolves.toEqual({ media });
    expect(video.stop).not.toHaveBeenCalled();
  });

  it("names the failure, and says nothing once the page was left", async () => {
    stubMedia(async () => {
      throw fail("NotAllowedError");
    });
    await expect(acquireMedia(null, null, () => true)).resolves.toEqual({ failure: "denied" });
    await expect(acquireMedia(null, null, () => false)).resolves.toBeNull();
  });

  it("treats an error that is not an Error as an unavailable device", async () => {
    stubMedia(() => Promise.reject("boom"));
    await expect(acquireMedia(null, null, () => true)).resolves.toEqual({ failure: "unavailable" });
  });
});

describe("finishedAction (AC-1, AC-7)", () => {
  const done = {
    blob: new Blob(["x".repeat(10)], { type: "video/webm" }),
    durationMs: 5000,
    container: "webm" as const,
    stoppedByPerson: true,
    hiddenDuring: false,
    trackEnded: false,
  };

  it("drops a recording that is too short or empty", () => {
    expect(finishedAction({ ...done, durationMs: 200 })).toEqual({ type: "discarded" });
    expect(finishedAction({ ...done, blob: new Blob([]) })).toEqual({ type: "discarded" });
  });

  it("keeps a take the creator stopped, with no note", () => {
    const action = finishedAction(done);
    expect(action.type).toBe("stopped");
    if (action.type !== "stopped") return;
    expect(action.take.note).toBeUndefined();
    expect(action.take.durationMs).toBe(5000);
    expect(action.take.fileName).toMatch(/^Recording \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.webm$/);
  });

  it("keeps what was captured when the browser ended it, and says why", () => {
    const note = (extra: Partial<typeof done>) => {
      const action = finishedAction({ ...done, stoppedByPerson: false, ...extra });
      return action.type === "stopped" ? action.take.note : "not stopped";
    };
    expect(note({ hiddenDuring: true })).toMatch(/background/);
    expect(note({ trackEnded: true })).toMatch(/taken away/);
    expect(note({ hiddenDuring: true, trackEnded: true })).toMatch(/taken away/);
    expect(note({})).toMatch(/stopped on its own/);
  });

  it("gives no note for a Stop press even if the page was hidden meanwhile", () => {
    const action = finishedAction({ ...done, hiddenDuring: true });
    expect(action.type === "stopped" && action.take.note).toBeUndefined();
  });
});

describe("checkBrowser (AC-4, AC-5)", () => {
  const supported = (types: string[]) =>
    class {
      static isTypeSupported = (t: string) => types.includes(t);
    };

  it("picks the first type the browser can record and reports no problem", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
    vi.stubGlobal("MediaRecorder", supported(["video/webm"]));
    const result = checkBrowser();
    expect(result.problem).toBeNull();
    expect(result.picked?.container).toBe("webm");
  });

  it("names an insecure page before anything else", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("MediaRecorder", supported(["video/webm"]));
    expect(checkBrowser().problem).toBe("insecure");
  });

  it("names a browser with no MediaRecorder, and one with no type it can use", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
    expect(checkBrowser()).toMatchObject({ picked: null, problem: "unsupported" });
    vi.stubGlobal("MediaRecorder", supported([]));
    expect(checkBrowser()).toMatchObject({ picked: null, problem: "unsupported" });
  });
});

describe("createRecorder", () => {
  it("collects non empty chunks only", () => {
    const made: { ondataavailable?: (e: { data: Blob }) => void; options?: unknown } = {};
    vi.stubGlobal(
      "MediaRecorder",
      class {
        constructor(_: unknown, options: unknown) {
          made.options = options;
          Object.defineProperty(this, "ondataavailable", {
            set: (fn) => (made.ondataavailable = fn),
          });
        }
      },
    );
    const got: Blob[] = [];
    createRecorder(streamOf([]), "video/webm", (c) => got.push(c));
    made.ondataavailable?.({ data: new Blob([]) });
    made.ondataavailable?.({ data: new Blob(["ab"]) });
    expect(got.map((b) => b.size)).toEqual([2]);
    expect(made.options).toMatchObject({ mimeType: "video/webm" });
  });
});

describe("idsOf and keepAwake", () => {
  it("reads the devices the browser actually chose, null when a track is missing", () => {
    expect(idsOf(streamOf([track("cam")], [track("mic")]))).toEqual({ camera: "cam", mic: "mic" });
    expect(idsOf(streamOf([track("cam")]))).toEqual({ camera: "cam", mic: null });
    expect(idsOf(streamOf([track()]))).toEqual({ camera: null, mic: null });
  });

  it("asks for the screen wake lock, and gives null when there is none or it is refused (AC-7)", async () => {
    const lock = { release: vi.fn() };
    vi.stubGlobal("navigator", { wakeLock: { request: vi.fn(async () => lock) } });
    await expect(keepAwake()).resolves.toBe(lock);
    vi.stubGlobal("navigator", {});
    await expect(keepAwake()).resolves.toBeNull();
    vi.stubGlobal("navigator", {
      wakeLock: {
        request: async () => {
          throw fail("NotAllowedError");
        },
      },
    });
    await expect(keepAwake()).resolves.toBeNull();
  });
});
