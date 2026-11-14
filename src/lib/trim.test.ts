import { describe, expect, it } from "vitest";
import {
  alignToFrames,
  pushPlan,
  cutsFromSilences,
  keepRanges,
  outputFps,
  parseSilences,
  progressOutTimeMs,
  renderFilterScript,
  SMOOTH,
  zoomPlan,
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
      "[0:a]atrim=start=1.400000:end=3.250000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.030000,afade=t=out:st=1.820000:d=0.030000[a0];",
      "[0:v]trim=start=4.249999:end=17.599999,setpts=PTS-STARTPTS[v1];",
      "[0:a]atrim=start=4.250000:end=17.600000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.030000[a1];",
      "[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][aout];",
      "[vc]zscale=tin=smpte2084:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p[vout]",
    ]);
    expect(renderFilterScript([{ startMs: 0, endMs: 1_000 }], { hdr: null })).toContain(
      "[vc]format=yuv420p[vout]",
    );
  });

  it("fades audio 30 ms on edges that touch a cut, none at the take's start and end (spec 0020 AC-1)", () => {
    const script = renderFilterScript(
      [
        { startMs: 0, endMs: 2_000 },
        { startMs: 3_000, endMs: 5_000 },
        { startMs: 6_000, endMs: 10_000 },
      ],
      { hdr: null, durationMs: 10_000 },
    );
    const audio = script.split("\n").filter((l) => l.startsWith("[0:a]"));
    expect(audio[0]).toContain("afade=t=out");
    expect(audio[0]).not.toContain("afade=t=in");
    expect(audio[1]).toContain("afade=t=in");
    expect(audio[1]).toContain("afade=t=out");
    expect(audio[2]).toContain("afade=t=in");
    expect(audio[2]).not.toContain("afade=t=out");
    // A last piece that stops before the take's end has a cut at its end.
    const tail = renderFilterScript(
      [
        { startMs: 0, endMs: 2_000 },
        { startMs: 3_000, endMs: 5_000 },
      ],
      { hdr: null, durationMs: 10_000 },
    );
    expect(tail.split("\n").filter((l) => l.startsWith("[0:a]"))[1]).toContain("afade=t=out");
  });

  it("gives a piece shorter than twice the fade fades of half its length (AC-1)", () => {
    const script = renderFilterScript(
      [
        { startMs: 0, endMs: 1_000 },
        { startMs: 2_000, endMs: 2_040 },
        { startMs: 3_000, endMs: 4_000 },
      ],
      { hdr: null, durationMs: 4_000 },
    );
    const mid = script.split("\n").filter((l) => l.startsWith("[0:a]"))[1];
    expect(mid).toContain("afade=t=in:st=0:d=0.020000");
    expect(mid).toContain("afade=t=out:st=0.020000:d=0.020000");
  });

  it("alternates zoom per piece, short pieces keep the previous zoom (AC-3)", () => {
    const r = (startMs: number, length: number) => ({ startMs, endMs: startMs + length });
    expect(zoomPlan([r(0, 2_000), r(3_000, 2_000), r(6_000, 500), r(7_000, 2_000)])).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(SMOOTH.zoomScale).toBe(1.08);
    const script = renderFilterScript([r(0, 2_000), r(3_000, 2_000)], {
      hdr: null,
      size: { width: 1920, height: 1080 },
      durationMs: 5_000,
    });
    const video = script.split("\n").filter((l) => l.startsWith("[0:v]"));
    expect(video[0]).not.toContain("crop=");
    // A 2 s piece after a cut zooms to 1.08 and pushes to 1.12 (spec 0020 step 4).
    expect(video[1]).toContain("(1.08+0.04*t/2.000000)");
    // crop's own centring reads the size once, so x and y spell out the centre per frame.
    expect(video[1]).toContain(
      ":eval=frame,crop=1920:1080:x='(ceil(1920*(1.08+0.04*t/2.000000)/2)*2-1920)/2':y='(ceil(1080*(1.08+0.04*t/2.000000)/2)*2-1080)/2',setsar=1[v1]",
    );
    // A short piece after a pushed one holds the final scale 1.12 (spec 0020 AC-5).
    const short = renderFilterScript([r(0, 2_000), r(3_000, 2_000), r(6_000, 500)], {
      hdr: null,
      size: { width: 1920, height: 1080 },
      durationMs: 7_000,
    });
    expect(short.split("\n").filter((l) => l.startsWith("[0:v]"))[2]).toContain(
      "scale=2152:1210,crop=1920:1080:x=116:y=65,setsar=1[v2]",
    );
    // With a background the zoom is still per piece, before the concat.
    const keyed = renderFilterScript([r(0, 2_000), r(3_000, 2_000)], {
      hdr: null,
      size: { width: 1920, height: 1080 },
      durationMs: 5_000,
      background: { keyColor: "#00b140", width: 1920, height: 1080 },
    });
    expect(keyed.indexOf(":eval=frame")).toBeLessThan(keyed.indexOf("concat="));
  });

  it("pushes slowly on kept pieces of 1 s or more after a cut (AC-7)", () => {
    const r = (startMs: number, length: number) => ({ startMs, endMs: startMs + length });
    expect(SMOOTH.pushScale).toBe(0.04);
    const script = renderFilterScript([r(0, 3_000), r(4_000, 1_000), r(6_000, 999)], {
      hdr: null,
      size: { width: 1920, height: 1080 },
      durationMs: 8_000,
    });
    const video = script.split("\n").filter((l) => l.startsWith("[0:v]"));
    // The first piece follows no cut: no push, no zoom.
    expect(video[0]).not.toContain("scale=");
    // Pushed from 1.00 up to 1.04 would be an unzoomed piece; this one is zoomed (1.08 to 1.12).
    expect(video[1]).toContain("(1.08+0.04*t/1.000000)");
    expect(video[1]).toContain("ceil(1920*(1.08+0.04*t/1.000000)/2)*2");
    // Under 1 s: no push; it keeps the previous zoom as the plain crop.
    expect(video[2]).not.toContain("eval=frame");
    // Uncut takes: no push.
    const uncut = renderFilterScript([r(0, 5_000)], {
      hdr: null,
      size: { width: 1920, height: 1080 },
      durationMs: 5_000,
    });
    expect(uncut).not.toContain("eval=frame");
    // An unzoomed piece after a cut pushes from 1.00.
    const flip = renderFilterScript([r(0, 2_000), r(3_000, 2_000), r(6_000, 2_000)], {
      hdr: null,
      size: { width: 1920, height: 1080 },
      durationMs: 8_000,
    });
    expect(flip.split("\n").filter((l) => l.startsWith("[0:v]"))[2]).toContain(
      "(1+0.04*t/2.000000)",
    );
  });

  it("fades both edges of a single piece when cuts trim the start and the end (AC-1)", () => {
    const script = renderFilterScript([{ startMs: 1_000, endMs: 9_000 }], {
      hdr: null,
      durationMs: 10_000,
    });
    const audio = script.split("\n").find((l) => l.startsWith("[0:a]")) ?? "";
    expect(audio).toContain("afade=t=in:st=0:d=0.030000");
    expect(audio).toContain("afade=t=out:st=7.970000:d=0.030000");
  });

  it("renders a take with no cuts as before (AC-4)", () => {
    const script = renderFilterScript([{ startMs: 0, endMs: 10_000 }], {
      hdr: null,
      size: { width: 1920, height: 1080 },
      durationMs: 10_000,
    });
    expect(script).not.toContain("afade");
    expect(script).not.toContain("crop=");
  });

  it("does not fade an uncut take whose end was rounded down by frame alignment", () => {
    const script = renderFilterScript([{ startMs: 0, endMs: 10_000 }], {
      hdr: null,
      durationMs: 10_010,
    });
    expect(script).not.toContain("afade");
  });

  it("still fades the end of a real trailing cut of one frame (within 50 ms of the end)", () => {
    const script = renderFilterScript([{ startMs: 0, endMs: 9_966.667 }], {
      hdr: null,
      durationMs: 10_000,
      fps: 30,
    });
    expect(script).toContain("afade=t=out");
    // At 60 fps an end half a frame early is still the take's own end.
    const uncut = renderFilterScript([{ startMs: 0, endMs: 9_992 }], {
      hdr: null,
      durationMs: 10_000,
      fps: 60,
    });
    expect(uncut).not.toContain("afade");
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
      "[base]setpts=PTS-STARTPTS,format=yuva444p,chromakey=0x00b140:0.12:0.08,despill=type=green[fg];",
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

describe("pushPlan and a short piece after a push (spec 0020 AC-5)", () => {
  const keep = [
    { startMs: 0, endMs: 3_000 },
    { startMs: 4_000, endMs: 7_000 },
    { startMs: 7_100, endMs: 7_400 },
  ];
  it("marks every piece after the first long one", () => {
    expect(pushPlan(keep)).toEqual([false, true, true]);
    expect(
      pushPlan([
        { startMs: 0, endMs: 3_000 },
        { startMs: 3_100, endMs: 3_300 },
      ]),
    ).toEqual([false, false]);
  });
  it("holds the final push scale on a short piece instead of jumping back", () => {
    const script = renderFilterScript(keep, { hdr: null, size: { width: 1920, height: 1080 } });
    const lines = script.split("\n");
    const short = lines.find((l) => l.startsWith("[0:v]") && l.endsWith("[v2];")) ?? "";
    // Piece 1 is zoomed (1.1 base), so the short piece holds 1.1 + the push.
    const scale = SMOOTH.zoomScale + SMOOTH.pushScale;
    expect(short).toContain(`scale=${Math.ceil((1920 * scale) / 2) * 2}:`);
    expect(short).not.toContain("crop=1745");
    expect(short).not.toContain("t/");
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
    expect(aligned[1]?.startMs).toBeCloseTo(4_233.333, 2);
  });

  it("snaps a start down and an end up, so a kept word is never trimmed (spec 0020 AC-7)", () => {
    const [r] = alignToFrames([{ startMs: 1_000, endMs: 1_010 }], 30);
    expect(r?.startMs).toBeCloseTo(1_000, 6);
    expect(r?.endMs).toBeCloseTo(1_033.333, 2);
    const [late] = alignToFrames([{ startMs: 1_001, endMs: 2_000 }], 30);
    expect(late?.startMs).toBeCloseTo(1_000, 6);
  });

  it("keeps a time already on a frame where it is", () => {
    const frame = 1000 / 30;
    const [r] = alignToFrames([{ startMs: 3 * frame, endMs: 9 * frame }], 30);
    expect(r?.startMs).toBeCloseTo(3 * frame, 9);
    expect(r?.endMs).toBeCloseTo(9 * frame, 9);
  });

  it("merges ranges that touch after aligning, so they never overlap", () => {
    const out = alignToFrames(
      [
        { startMs: 0, endMs: 1_010 },
        { startMs: 1_020, endMs: 2_000 },
      ],
      30,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.endMs).toBeCloseTo(2_000, 6);
    const apart = alignToFrames(
      [
        { startMs: 0, endMs: 1_000 },
        { startMs: 1_200, endMs: 2_000 },
      ],
      30,
    );
    expect(apart).toHaveLength(2);
  });

  it("defaults to 30 fps and drops an empty range", () => {
    expect(alignToFrames([{ startMs: 5, endMs: 5 }], 30)).toEqual([]);
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
