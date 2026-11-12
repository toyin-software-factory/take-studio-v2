import { describe, expect, it } from "vitest";
import {
  alignToFrames,
  cutsFromSilences,
  keepRanges,
  outputFps,
  parseSilences,
  progressOutTimeMs,
  renderFilterScript,
  silencedetectFilter,
  throttledProgress,
  totalMs,
} from "./trim";

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

describe("keepRanges and the render graph (AC-6)", () => {
  it("keeps the complement of the removed ranges", () => {
    const keep = keepRanges(
      [
        { startMs: 0, endMs: 1_400 },
        { startMs: 3_250, endMs: 4_250 },
        { startMs: 17_600, endMs: 20_000 },
      ],
      20_000,
    );
    expect(keep).toEqual([
      { startMs: 1_400, endMs: 3_250 },
      { startMs: 4_250, endMs: 17_600 },
    ]);
    expect(totalMs(keep)).toBe(15_200);
  });

  it("caps the segments by dropping the shortest cuts", () => {
    const removed = Array.from({ length: 10 }, (_, i) => ({
      startMs: i * 1_000 + 100,
      endMs: i * 1_000 + 200 + (i === 4 ? 500 : 0),
    }));
    const keep = keepRanges(removed, 10_000, 3);
    expect(keep).toHaveLength(3);
    // The longest cut (index 4, 600 ms) is one of the two kept.
    expect(keep.some((r) => r.endMs === 4_100)).toBe(true);
  });

  it("cuts video and audio at the same times and tone maps only HDR, with tin spelled out", () => {
    const script = renderFilterScript(
      [
        { startMs: 1_400, endMs: 3_250 },
        { startMs: 4_250, endMs: 17_600 },
      ],
      { hdr: "smpte2084" },
    );
    expect(script.split("\n")).toEqual([
      "[0:v]trim=start=1.399999:end=3.249999,setpts=PTS-STARTPTS[v0];",
      "[0:a]atrim=start=1.400000:end=3.250000,asetpts=PTS-STARTPTS[a0];",
      "[0:v]trim=start=4.249999:end=17.599999,setpts=PTS-STARTPTS[v1];",
      "[0:a]atrim=start=4.250000:end=17.600000,asetpts=PTS-STARTPTS[a1];",
      "[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][aout];",
      "[vc]zscale=tin=smpte2084:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p[vout]",
    ]);
    expect(renderFilterScript([{ startMs: 0, endMs: 1_000 }], { hdr: null })).toContain(
      "[vc]format=yuv420p[vout]",
    );
  });

  it("has no audio branch for a take with no sound", () => {
    const script = renderFilterScript(
      [
        { startMs: 0, endMs: 1_000 },
        { startMs: 2_000, endMs: 3_000 },
      ],
      { hdr: null, hasAudio: false },
    );
    expect(script).not.toContain("[0:a]");
    expect(script).not.toContain("[aout]");
    expect(script).toContain("[v0][v1]concat=n=2:v=1:a=0[vc];");
  });

  it("keys onto a background after the colour step, tone mapped first for HDR (spec 0008)", () => {
    const background = { keyColor: "#00b140", width: 1080, height: 1920 };
    const sdr = renderFilterScript([{ startMs: 0, endMs: 1_000 }], { hdr: null, background });
    expect(sdr.split("\n").slice(-4)).toEqual([
      "[vc]format=yuv420p[base];",
      "[base]format=yuva444p,chromakey=0x00b140:0.12:0.08,despill=type=green[fg];",
      "[1:v]scale=1080:1920:force_original_aspect_ratio=increase:out_range=tv,crop=1080:1920,setsar=1,format=yuv420p[bg];",
      "[bg][fg]overlay=format=auto:shortest=1,format=yuv420p[vout]",
    ]);
    const hdr = renderFilterScript([{ startMs: 0, endMs: 1_000 }], {
      hdr: "smpte2084",
      background,
    });
    // The tone map comes before the key, so the key colour is measured on the same pixels.
    expect(hdr.indexOf("tonemap=")).toBeLessThan(hdr.indexOf("chromakey="));
    expect(hdr).toContain("[vc]zscale=tin=smpte2084");
    // A render with a background and no sound keeps no audio branch and still composites.
    const mute = renderFilterScript([{ startMs: 0, endMs: 1_000 }], {
      hdr: null,
      hasAudio: false,
      background,
    });
    expect(mute).not.toContain("[aout]");
    expect(mute).toContain("[vout]");
  });

  it("rounds the output frame rate to the source's average", () => {
    expect(outputFps(29.97)).toBe("29.97");
    expect(outputFps(30)).toBe("30");
    expect(outputFps(null)).toBe("30");
  });
});

describe("alignToFrames (AC-6 sync)", () => {
  it("snaps every keep range to the frame grid so audio and video cut at the same instant", () => {
    const aligned = alignToFrames(
      [
        { startMs: 1_401, endMs: 3_250 },
        { startMs: 4_251, endMs: 8_250 },
      ],
      30,
    );
    const frame = 1000 / 30;
    for (const r of aligned) {
      expect(Math.abs(r.startMs / frame - Math.round(r.startMs / frame))).toBeLessThan(1e-9);
      expect(Math.abs(r.endMs / frame - Math.round(r.endMs / frame))).toBeLessThan(1e-9);
    }
    expect(aligned[0]?.startMs).toBeCloseTo(1_400, 6);
    expect(aligned[1]?.startMs).toBeCloseTo(4_266.667, 2);
  });

  it("drops a range shorter than half a frame and defaults to 30 fps", () => {
    expect(alignToFrames([{ startMs: 1_000, endMs: 1_010 }], 30)).toEqual([]);
    expect(alignToFrames([{ startMs: 0, endMs: 1_000 }], null)).toHaveLength(1);
  });
});

describe("progress (Flow step 6)", () => {
  it("reads the latest out time from a -progress chunk", () => {
    expect(
      progressOutTimeMs("frame=10\nout_time_us=6016000\nout_time_ms=6016000\nprogress=continue"),
    ).toBe(6_016);
    expect(progressOutTimeMs("frame=10")).toBeNull();
  });

  it("writes at most every 2 s and only on a change of at least 1 point, then flushes the last", async () => {
    let clock = 0;
    const written: number[] = [];
    const progress = throttledProgress(async (p) => void written.push(p), { now: () => clock });
    await progress.report(0.4); // 0 → written (first)
    await progress.report(5); // too soon
    clock = 2_500;
    await progress.report(5.9); // 5 → written
    clock = 5_000;
    await progress.report(5.2); // same point → skipped
    clock = 7_500;
    await progress.report(42); // written
    await progress.report(99); // too soon, pending
    await progress.flush(); // 99 written
    expect(written).toEqual([0, 5, 42, 99]);
  });

  it("never lets a failed progress write reject (best effort)", async () => {
    const progress = throttledProgress(async () => {
      throw new Error("db down");
    });
    await expect(progress.report(10)).resolves.toBeUndefined();
    await expect(progress.flush()).resolves.toBeUndefined();
  });

  it("writes one at a time in order, and flush waits for writes still in flight", async () => {
    let clock = 0;
    const log: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const progress = throttledProgress(
      async (p) => {
        log.push(`start ${p}`);
        if (p === 10) await gate; // the first write is slow
        log.push(`end ${p}`);
      },
      { now: () => clock },
    );
    void progress.report(10); // not awaited, like the ffmpeg callback
    clock = 5_000;
    void progress.report(50); // must wait for the 10 write
    let flushed = false;
    const flushing = progress.flush().then(() => (flushed = true));
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await flushing;
    expect(log).toEqual(["start 10", "end 10", "start 50", "end 50"]);
  });
});
