import { describe, expect, it } from "vitest";
import { keepRanges, renderFilterScript, SMOOTH, zoomPlan, totalMs } from "./trim";

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
});
