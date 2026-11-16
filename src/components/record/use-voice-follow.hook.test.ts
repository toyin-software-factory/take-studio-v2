// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VOICE_HOLD_MS } from "@/lib/follow-state";
import { useVoiceFollow } from "./use-voice-follow";

// Side effects of `useVoiceFollow` (spec 0021 step 2) with a fake token call, a fake WebSocket and
// a fake microphone path: a late socket stays silent, stop and unmount release everything.
vi.mock("@/components/takes/browser-io", () => ({
  callApi: async () => ({ status: 200, data: { token: "tok", expiresInSeconds: 60 } }),
}));

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

class FakeContext {
  static all: FakeContext[] = [];
  state = "running";
  closed = false;
  audioWorklet = { addModule: async () => undefined };
  constructor() {
    FakeContext.all.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  resume = async () => undefined;
  createMediaStreamSource = () => ({ connect: () => undefined });
  close = async () => {
    this.closed = true;
  };
}

class FakeNode {
  port: { onmessage: ((e: unknown) => void) | null } = { onmessage: null };
}

const mic = { getAudioTracks: () => [{}] } as unknown as MediaStream;
const noMic = { getAudioTracks: () => [] } as unknown as MediaStream;
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  FakeContext.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeNode);
  vi.stubGlobal("MediaStream", class {});
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const props = (over: Partial<Parameters<typeof useVoiceFollow>[0]> = {}) => ({
  script: "one two three four",
  stream: mic as MediaStream | null,
  enabled: true,
  countdown: true,
  recording: false,
  startWord: () => 0,
  ...over,
});

describe("useVoiceFollow side effects", () => {
  it("closes a socket that opens after the hold ran out, and sends no audio", async () => {
    const { result, rerender } = renderHook((p) => useVoiceFollow(p), {
      initialProps: props({ stream: noMic }),
    });
    await settle();
    const [socket] = FakeSocket.all;
    expect(socket).toBeDefined();
    // Recording starts while the socket is still connecting: the hold is over, following is off.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VOICE_HOLD_MS);
    });
    rerender(props({ stream: noMic, countdown: false, recording: true }));
    await settle();
    expect(result.current.status).toBe("fallback");
    act(() => socket!.open());
    expect(socket!.closed).toBe(true);
    expect(socket!.sent).not.toContainEqual(expect.any(ArrayBuffer));
    expect(result.current.status).toBe("fallback");
  });

  it("closes the socket and releases the microphone path when recording stops", async () => {
    const { rerender } = renderHook((p) => useVoiceFollow(p), { initialProps: props() });
    await settle();
    const socket = FakeSocket.all[0]!;
    act(() => socket.open());
    rerender(props({ countdown: false, recording: true }));
    await settle();
    expect(FakeContext.all).toHaveLength(1);
    expect(FakeContext.all[0]!.closed).toBe(false);

    rerender(props({ countdown: false, recording: false }));
    await settle();
    expect(socket.closed).toBe(true);
    expect(socket.sent).toContain(JSON.stringify({ type: "CloseStream" }));
    expect(FakeContext.all[0]!.closed).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("closes the socket and leaves no timer running when unmounted", async () => {
    const { unmount, rerender } = renderHook((p) => useVoiceFollow(p), { initialProps: props() });
    await settle();
    const socket = FakeSocket.all[0]!;
    act(() => socket.open());
    rerender(props({ countdown: false, recording: true }));
    await settle();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(socket.closed).toBe(true);
    expect(FakeContext.all[0]!.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing while following is off", async () => {
    renderHook((p) => useVoiceFollow(p), { initialProps: props({ enabled: false }) });
    await settle();
    expect(FakeSocket.all).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
