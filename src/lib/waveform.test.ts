import { describe, expect, it } from "vitest";
import { levelFromRms, samplesFromPcm16, waveformBuckets, waveformFromSamples } from "./waveform";

const tone = (n: number, amp: number) => Float32Array.from({ length: n }, () => amp);

describe("waveformBuckets", () => {
  it("is one per 100 ms, rounded up, capped at 1000, at least 1", () => {
    expect(waveformBuckets(1_000)).toBe(10);
    expect(waveformBuckets(1_050)).toBe(11);
    expect(waveformBuckets(100_000)).toBe(1000);
    expect(waveformBuckets(600_000)).toBe(1000);
    expect(waveformBuckets(1)).toBe(1);
  });
});

describe("levelFromRms", () => {
  it("scales dBFS from a -60 dB floor", () => {
    expect(levelFromRms(1)).toBe(100);
    expect(levelFromRms(0.1)).toBe(67); // -20 dB
    expect(levelFromRms(0.001)).toBe(0); // -60 dB
    expect(levelFromRms(0.0001)).toBe(0); // below the floor
    expect(levelFromRms(2)).toBe(100); // clamped
  });
  it("is 0 for digital silence", () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(Number.NaN)).toBe(0);
  });
});

describe("waveformFromSamples", () => {
  it("never returns more than 1000 values, each an integer 0 to 100", () => {
    const wave = waveformFromSamples(tone(8000 * 300, 0.5), 300_000);
    expect(wave).toHaveLength(1000);
    expect(wave?.every((v) => Number.isInteger(v) && v >= 0 && v <= 100)).toBe(true);
  });
  it("gives ceil(durationMs / 100) values for a short take", () => {
    expect(waveformFromSamples(tone(8000 * 2, 0.5), 2_000)).toHaveLength(20);
  });
  it("follows loudness over time", () => {
    const samples = Float32Array.from({ length: 8000 * 2 }, (_, i) => (i < 8000 ? 0.5 : 0.01));
    const wave = waveformFromSamples(samples, 2_000);
    expect(wave?.slice(0, 10).every((v) => v === 90)).toBe(true); // -6 dB
    expect(wave?.slice(10).every((v) => v === 33)).toBe(true); // -40 dB
  });
  it("is all zeros for digital silence", () => {
    expect(waveformFromSamples(tone(8000, 0), 1_000)).toEqual(Array(10).fill(0));
  });
  it("is null with no samples or no length", () => {
    expect(waveformFromSamples(new Float32Array(0), 1_000)).toBeNull();
    expect(waveformFromSamples(tone(10, 0.5), 0)).toBeNull();
  });
});

describe("samplesFromPcm16", () => {
  it("reads little endian signed 16 bit samples", () => {
    const bytes = Uint8Array.from([0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f]);
    expect(Array.from(samplesFromPcm16(bytes))).toEqual([0.5, -0.5, 32767 / 32768]);
  });
});
