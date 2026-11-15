import { describe, expect, it } from "vitest";
import { cutsFromSilences, parseSilences, silencedetectFilter } from "./trim";

describe("parseSilences", () => {
  it("reads real silencedetect output, flooring starts and ceiling ends", () => {
    const stderr = [
      "[silencedetect @ 0x7f] silence_start: 2",
      "[silencedetect @ 0x7f] silence_end: 4.000042 | silence_duration: 2.000042",
      "[silencedetect @ 0x7f] silence_start: 7.9876",
      "[silencedetect @ 0x7f] silence_end: 9.0001 | silence_duration: 1.01",
    ].join("\n");
    expect(parseSilences(stderr, 20_000)).toEqual([
      { startMs: 2_000, endMs: 4_001 },
      { startMs: 7_987, endMs: 9_001 },
    ]);
  });

  it("ends a silence still open at the end of the stream at the take's length", () => {
    expect(parseSilences("[s] silence_start: 17.5", 20_000)).toEqual([
      { startMs: 17_500, endMs: 20_000 },
    ]);
  });

  it("clamps to the take", () => {
    expect(parseSilences("silence_start: -0.01\nsilence_end: 25 | x", 20_000)).toEqual([
      { startMs: 0, endMs: 20_000 },
    ]);
  });

  it("uses -35 dB and 0.7 s", () => {
    expect(silencedetectFilter()).toBe("silencedetect=noise=-35dB:d=0.7");
  });
});
describe("cutsFromSilences (AC-5)", () => {
  const D = 20_000;

  it("keeps 250 ms on each side of a pause in the middle", () => {
    expect(cutsFromSilences([{ startMs: 3_000, endMs: 4_500 }], D)).toEqual([
      {
        startMs: 3_250,
        endMs: 4_250,
        kind: "pause",
        proposedBy: "rules",
        reason: "Pause of 1.5 s",
      },
    ]);
  });

  it("ignores silences shorter than 700 ms, and a 700 ms one leaves a 200 ms cut", () => {
    expect(cutsFromSilences([{ startMs: 6_000, endMs: 6_699 }], D)).toEqual([]);
    expect(cutsFromSilences([{ startMs: 6_000, endMs: 6_700 }], D)).toMatchObject([
      { startMs: 6_250, endMs: 6_450 },
    ]);
  });

  it("keeps only 100 ms next to speech when the silence touches the start or the end", () => {
    expect(
      cutsFromSilences(
        [
          { startMs: 0, endMs: 1_500 },
          { startMs: 17_500, endMs: D },
        ],
        D,
      ),
    ).toMatchObject([
      { startMs: 0, endMs: 1_400 },
      { startMs: 17_600, endMs: D },
    ]);
  });

  it("merges cuts closer than 100 ms apart", () => {
    // Pauses ending 50 ms apart after margins: [3250,4250] then [4300,5250].
    const cuts = cutsFromSilences(
      [
        { startMs: 3_000, endMs: 4_500 },
        { startMs: 4_050, endMs: 5_500 },
      ],
      D,
    );
    expect(cuts).toMatchObject([{ startMs: 3_250, endMs: 5_250, reason: "Pause of 1.5 s" }]);
    // 100 ms or more apart: kept separate.
    const apart = cutsFromSilences(
      [
        { startMs: 3_000, endMs: 4_500 },
        { startMs: 4_100, endMs: 5_500 },
      ],
      D,
    );
    expect(apart).toHaveLength(2);
  });

  it("never cuts a take that is silence from start to end", () => {
    expect(cutsFromSilences([{ startMs: 0, endMs: D }], D)).toEqual([]);
  });
});
