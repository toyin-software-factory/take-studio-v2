import { describe, expect, it } from "vitest";
import {
  alignToFrames,
  pushPlan,
  outputFps,
  renderLengthSeconds,
  progressOutTimeMs,
  renderFilterScript,
  SMOOTH,
  throttledProgress,
} from "./trim";

describe("keepRanges and the render graph (AC-6)", () => {
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

  it("drops an internal cut that covers no whole frame (spec 0020 AC-5)", () => {
    const out = alignToFrames(
      [
        { startMs: 0, endMs: 1_010 },
        { startMs: 1_050, endMs: 2_000 },
      ],
      30,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.startMs).toBeCloseTo(0, 6);
    expect(out[0]?.endMs).toBeCloseTo(2_000, 6);
  });

  it("shortens a trailing edge cut by up to one frame (spec 0020 AC-5)", () => {
    // A 1990 ms take with the cut [1950, 1990]: keep [0, 1950] ends on the next frame, 1966.7 ms.
    const [r] = alignToFrames([{ startMs: 0, endMs: 1_950 }], 30);
    expect(r?.endMs).toBeCloseTo(1_966.667, 2);
  });

  it("drops a trailing edge cut shorter than a frame (spec 0020 AC-5)", () => {
    // A 2000 ms take with the cut [1990, 2000]: keep [0, 1990] ends on the take's last frame.
    const [r] = alignToFrames([{ startMs: 0, endMs: 1_990 }], 30);
    expect(r?.endMs).toBeCloseTo(2_000, 6);
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
describe("renderLengthSeconds (B2-T96)", () => {
  it("adds the kept ranges, so the file is the original minus the cuts", () => {
    expect(
      renderLengthSeconds([
        { startMs: 0, endMs: 3000 },
        { startMs: 5000, endMs: 10020 },
      ]),
    ).toBe("8.020000");
  });

  it("is the whole take when nothing is cut", () => {
    expect(renderLengthSeconds([{ startMs: 0, endMs: 4500 }])).toBe("4.500000");
  });
});
