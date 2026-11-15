import { describe, expect, it, vi } from "vitest";
import { createAudioGate, type SocketLike, connectRealtime } from "./realtime-stream";

function fakeSocket() {
  const sent: unknown[] = [];
  const s: Omit<SocketLike, "readyState"> & {
    readyState: number;
    open: () => void;
    say: (d: unknown) => void;
  } = {
    readyState: 0,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (d) => void sent.push(d),
    close: vi.fn(() => {
      s.readyState = 3;
    }),
    open: () => {
      s.readyState = 1;
      s.onopen?.();
    },
    say: (d) => s.onmessage?.({ data: d }),
  };
  return { s, sent };
}
describe("createAudioGate (B2-T115): no audio leaves before recording starts", () => {
  const frame = (n: number) => new Uint8Array([n]).buffer;

  it("never sends a frame pushed before recording, even with the socket open", () => {
    const sent: ArrayBuffer[] = [];
    const gate = createAudioGate((f) => sent.push(f));
    gate.push(frame(1));
    gate.open();
    gate.push(frame(2));
    expect(sent).toHaveLength(0);
    // Starting to record does not resurrect the earlier frames.
    gate.startRecording();
    expect(sent).toHaveLength(0);
    gate.push(frame(3));
    expect(sent).toHaveLength(1);
    expect(new Uint8Array(sent[0]!)[0]).toBe(3);
  });

  it("holds the opening words while recording until the socket opens, then sends them in order", () => {
    const sent: number[] = [];
    const gate = createAudioGate((f) => sent.push(new Uint8Array(f)[0]!));
    gate.startRecording();
    gate.push(frame(1));
    gate.push(frame(2));
    expect(sent).toEqual([]);
    gate.open();
    expect(sent).toEqual([1, 2]);
    gate.push(frame(3));
    expect(sent).toEqual([1, 2, 3]);
  });

  it("keeps only the newest frames while the socket is still opening", () => {
    const sent: number[] = [];
    const gate = createAudioGate((f) => sent.push(new Uint8Array(f)[0]!), 2);
    gate.startRecording();
    for (const n of [1, 2, 3]) gate.push(frame(n));
    gate.open();
    expect(sent).toEqual([2, 3]);
  });

  it("stops sending when recording stops, and drops what was held", () => {
    const sent: number[] = [];
    const gate = createAudioGate((f) => sent.push(new Uint8Array(f)[0]!));
    gate.startRecording();
    gate.push(frame(1));
    gate.stopRecording();
    gate.open();
    gate.push(frame(2));
    expect(sent).toEqual([]);
  });

  it("an open socket with no audio only sends keep alives across a long countdown gap", () => {
    // The socket opens at the countdown: with no audio it must not close (about 10 s of quiet).
    const timers: (() => void)[] = [];
    const { s: sock, sent } = fakeSocket();
    connectRealtime(
      "tok",
      { onOpen: () => undefined, onWords: () => undefined, onClose: () => undefined },
      {
        createSocket: () => sock as unknown as SocketLike,
        setInterval: (fn) => timers.push(fn),
        clearInterval: () => undefined,
      },
    );
    sock.open();
    for (let i = 0; i < 3; i += 1) timers[0]!();
    expect(sent.every((d) => typeof d === "string" && d.includes("KeepAlive"))).toBe(true);
    expect(sent).toHaveLength(3);
  });
});
