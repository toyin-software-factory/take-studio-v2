import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

const run = promisify(execFile);

/**
 * Timing spike for spec 0004 build plan step 1 (manual trigger only, no schedule, touches no
 * data): how long the slice 1 render takes on `large-1x` for a 10 minute 1080p HDR take.
 *
 * It generates its own fixture on the machine (so no upload), then runs the spec's render:
 * `trim`/`atrim` + `setpts`/`asetpts` per keep range and one `concat` from a
 * `-filter_complex_script`, CFR at the source fps, HDR (PQ, BT.2020) tone mapped to BT.709 with
 * `zscale` + `tonemap=hable`, `libx264 -preset fast -crf 18 -pix_fmt yuv420p`, AAC 192 kb/s,
 * `+faststart`. Output: timings and sizes only.
 */
const spikePayload = z.object({
  seconds: z.number().positive().max(7200).default(600),
  cuts: z.number().int().min(0).max(500).default(40),
});

export const renderSpikeTask = schemaTask({
  id: "render-spike",
  machine: "large-1x",
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  schema: spikePayload,
  run: async ({ seconds, cuts }) => {
    const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
    const dir = await mkdtemp(join(tmpdir(), "spike-"));
    try {
      const { stdout: version } = await run(ffmpeg, ["-hide_banner", "-version"]);
      const { stdout: filters } = await run(ffmpeg, ["-hide_banner", "-filters"]);
      const hasZscale = /\bzscale\b/.test(filters);

      // 1. Fixture: 1080p30 HEVC 10 bit tagged PQ / BT.2020, with a tone, like a phone HDR clip.
      const fixture = join(dir, "fixture.mov");
      const t0 = Date.now();
      await run(
        ffmpeg,
        [
          "-hide_banner",
          "-y",
          "-f",
          "lavfi",
          "-i",
          `testsrc2=size=1920x1080:rate=30:duration=${seconds}`,
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
          "-c:v",
          "libx265",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p10le",
          "-x265-params",
          "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
          "-color_primaries",
          "bt2020",
          "-color_trc",
          "smpte2084",
          "-colorspace",
          "bt2020nc",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          fixture,
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      const fixtureSeconds = (Date.now() - t0) / 1000;

      // 2. Keep ranges: remove `cuts` pauses of 1.5 s spread evenly (the trim step's output).
      const step = seconds / (cuts + 1);
      const removed = Array.from({ length: cuts }, (_, i) => [
        (i + 1) * step,
        (i + 1) * step + 1.5,
      ]);
      const keep: [number, number][] = [];
      let cursor = 0;
      for (const [start, end] of removed) {
        keep.push([cursor, start as number]);
        cursor = end as number;
      }
      keep.push([cursor, seconds]);

      // 3. The render filter graph, as the process-take task will build it.
      const tonemap = hasZscale
        ? // zscale needs the input transfer spelled out (it won't guess): the probe's HDR transfer
          // (smpte2084 for PQ, arib-std-b67 for HLG) goes into `tin`.
          "zscale=tin=smpte2084:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
        : "format=yuv420p";
      const lines = keep.flatMap(([s, e], i) => [
        `[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`,
        `[0:a]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS[a${i}];`,
      ]);
      const inputs = keep.map((_, i) => `[v${i}][a${i}]`).join("");
      lines.push(`${inputs}concat=n=${keep.length}:v=1:a=1[vc][ac];`);
      lines.push(`[vc]${tonemap}[vout]`);
      const script = join(dir, "graph.txt");
      await writeFile(script, lines.join("\n"));

      const output = join(dir, "render.mp4");
      const t1 = Date.now();
      await run(
        ffmpeg,
        [
          "-hide_banner",
          "-y",
          "-i",
          fixture,
          "-filter_complex_script",
          script,
          "-map",
          "[vout]",
          "-map",
          "[ac]",
          "-fps_mode",
          "cfr",
          "-r",
          "30",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-color_primaries",
          "bt709",
          "-color_trc",
          "bt709",
          "-colorspace",
          "bt709",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          output,
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      const renderSeconds = (Date.now() - t1) / 1000;

      const result = {
        ffmpeg: version.split("\n")[0] ?? "",
        zscale: hasZscale,
        sourceSeconds: seconds,
        cuts,
        keepRanges: keep.length,
        fixtureSeconds,
        renderSeconds,
        renderSpeed: Number((seconds / renderSeconds).toFixed(2)),
        fixtureBytes: (await stat(fixture)).size,
        renderBytes: (await stat(output)).size,
      };
      logger.info("render spike finished", result);
      return result;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
});
