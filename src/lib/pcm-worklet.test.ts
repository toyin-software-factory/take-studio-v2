import { describe, expect, it } from "vitest";
import { PCM_FRAME_SAMPLES, PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from "./pcm-worklet";

type Processor = {
  process: (inputs: Float32Array[][]) => boolean;
  port: { postMessage: (data: ArrayBuffer, transfer: ArrayBuffer[]) => void };
};

/** Run the real worklet source against fake globals, like the browser's audio thread would. */
function load(sampleRate: number) {
  const posted: Int16Array[] = [];
  let Ctor: (new () => Processor) | null = null;
  class FakeBase {
    port = {
      postMessage: (data: ArrayBuffer) => {
        posted.push(new Int16Array(data));
      },
    };
  }
  const register = (name: string, c: new () => Processor) => {
    expect(name).toBe(PCM_WORKLET_NAME);
    Ctor = c;
  };
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", PCM_WORKLET_SOURCE)(
    FakeBase,
    register,
    sampleRate,
  );
  if (!Ctor) throw new Error("not registered");
  return { processor: new (Ctor as new () => Processor)(), posted };
}

const sine = (n: number, amp = 0.5) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 10));

describe("pcm worklet (spec 0021 step 2)", () => {
  it("turns 48 kHz into 16 kHz frames of 1600 samples: three input samples per output sample", () => {
    const { processor, posted } = load(48000);
    // 480 000 input samples (10 s) in 128 sample blocks.
    for (let b = 0; b < 3750; b++) processor.process([[sine(128)]]);
    expect(posted.length).toBe(100);
    expect(posted.every((p) => p.length === PCM_FRAME_SAMPLES)).toBe(true);
  });

  it("passes 16 kHz through one for one and mixes channels to mono", () => {
    const { processor, posted } = load(16000);
    const l = new Float32Array(1600).fill(1);
    const r = new Float32Array(1600).fill(-1);
    processor.process([[l, r]]);
    expect(posted).toHaveLength(1);
    expect(Math.max(...posted[0]!.map(Math.abs))).toBeLessThanOrEqual(1);
    const loud = load(16000);
    loud.processor.process([[new Float32Array(1600).fill(1)]]);
    expect(loud.posted[0]![0]).toBe(32767);
    const quiet = load(16000);
    quiet.processor.process([[new Float32Array(1600).fill(-1)]]);
    expect(quiet.posted[0]![0]).toBe(-32768);
  });

  it("clips out of range samples and keeps running on empty input", () => {
    const { processor, posted } = load(16000);
    expect(processor.process([[]])).toBe(true);
    expect(processor.process([[new Float32Array(0)]])).toBe(true);
    processor.process([[new Float32Array(1600).fill(3)]]);
    expect(posted[0]![5]).toBe(32767);
  });
});
