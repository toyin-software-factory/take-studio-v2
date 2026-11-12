import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_MAX_FAILURES, PREVIEW_WAIT_MS } from "@/lib/background-preview-api";

// The preview wait loop (spec 0008, AC-4): the last answer counts, hidden time does not, and
// repeated failures stop it. The network is a stand in and time is faked.
const callApi = vi.fn();
vi.mock("./browser-io", () => ({ callApi: (...args: unknown[]) => callApi(...args) }));

const { fetchPreview } = await import("./use-background-preview");

const making = { status: 200, data: { state: "making", noGreenScreen: false } };
const ready = {
  status: 200,
  data: { state: "ready", url: "https://r2.test/p.jpg", noGreenScreen: false },
};
const post = { status: 202, data: { state: "making", noGreenScreen: false } };

beforeEach(() => {
  vi.useFakeTimers();
  callApi.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs the loop to its end, advancing the fake clock. */
async function run(stopped: () => boolean = () => false) {
  const done = fetchPreview("take-1", "bg-1", stopped);
  await vi.runAllTimersAsync();
  return done;
}

describe("fetchPreview", () => {
  it("returns a preview that is ready at once", async () => {
    callApi.mockResolvedValueOnce(ready);
    expect(await run()).toEqual({
      kind: "ready",
      url: "https://r2.test/p.jpg",
      noGreenScreen: false,
    });
    expect(callApi).toHaveBeenCalledTimes(1);
  });

  it("evaluates the last answer: a preview that turns ready on the final check is shown", async () => {
    // 45 checks fill the 90 s wait; the 46th is the last one made, and its answer must count.
    const checks = PREVIEW_WAIT_MS / 2000;
    callApi.mockResolvedValueOnce(post);
    for (let i = 0; i < checks; i += 1) callApi.mockResolvedValueOnce(making);
    callApi.mockResolvedValueOnce(ready);
    const out = await run();
    expect(out.kind).toBe("ready");
  });

  it("gives up after the total wait when it is never ready", async () => {
    callApi.mockResolvedValueOnce(post);
    callApi.mockResolvedValue(making);
    const out = await run();
    expect(out).toMatchObject({ kind: "failed" });
    if (out.kind === "failed") expect(out.message).toContain("taking longer");
    // About 45 checks, not hundreds.
    expect(callApi.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it("stops after repeated failed requests, however long each took", async () => {
    callApi.mockResolvedValueOnce(post);
    callApi.mockRejectedValue(new Error("timed out"));
    const out = await run();
    expect(out).toMatchObject({ kind: "failed" });
    // The start plus exactly the allowed failures in a row.
    expect(callApi).toHaveBeenCalledTimes(1 + PREVIEW_MAX_FAILURES);
  });

  it("recovers when a failed request is followed by an answer", async () => {
    callApi.mockResolvedValueOnce(post);
    callApi.mockRejectedValueOnce(new Error("blip"));
    callApi.mockResolvedValueOnce(ready);
    expect((await run()).kind).toBe("ready");
  });

  it("asks for nothing while the tab is hidden, and the hidden time does not count", async () => {
    const doc = { visibilityState: "hidden" };
    vi.stubGlobal("document", doc);
    callApi.mockResolvedValueOnce(post);
    callApi.mockResolvedValue(making);
    const done = fetchPreview("take-1", "bg-1", () => false);
    // Ten minutes hidden: no check is made, and the wait is not used up.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(callApi).toHaveBeenCalledTimes(1);
    callApi.mockResolvedValueOnce(ready);
    doc.visibilityState = "visible";
    await vi.runAllTimersAsync();
    expect((await done).kind).toBe("ready");
  });

  it("stops quietly when the choice changed", async () => {
    callApi.mockResolvedValueOnce(post);
    callApi.mockResolvedValue(making);
    let stop = false;
    const done = fetchPreview("take-1", "bg-1", () => stop);
    await vi.advanceTimersByTimeAsync(5000);
    stop = true;
    await vi.runAllTimersAsync();
    expect(await done).toEqual({ kind: "idle" });
  });

  it("fails with the server's message when the request is refused", async () => {
    callApi.mockResolvedValueOnce({
      status: 409,
      data: { error: "background_not_ready", message: "That background isn't ready yet." },
    });
    expect(await run()).toEqual({ kind: "failed", message: "That background isn't ready yet." });
  });
});
