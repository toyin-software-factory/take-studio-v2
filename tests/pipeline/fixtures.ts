/** The fixture table of the pipeline run and the scenario that checks one fixture end to end. */
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { uploadFailureMessage } from "../../src/lib/take-messages";
import { check } from "./checks";
import { db } from "./harness";
import { type Creator } from "./creator";
import { cutsOf, downloadRender, jobsOf, upload, waitFinal } from "./api";
import { avSync, renderFacts } from "./inspect";

export type Expect = {
  readonly status: "ready" | "failed";
  readonly failureCode?: string;
  readonly cuts?: ReadonlyArray<readonly [number, number]>;
  readonly note?: string | null;
  readonly render?: { width: number; height: number; colorTransfer?: string };
  readonly sync?: boolean;
  readonly messageIncludes?: string;
  /** A recorded take (spec 0021): created with `source: "recording"`, cuts checked by range. */
  readonly recording?: { readonly cutMs: readonly [number, number] };
};

export const FIXTURES: ReadonlyArray<readonly [string, string, "mp4" | "mov" | "webm", Expect]> = [
  // Spec 0021 AC-4, AC-14: what a browser recording makes, created as `source: "recording"`
  // through the same route. Each is 10 s of a synthetic tone with the 2.5 s pause 3.0 to 5.5 s, so one cut with the 250 ms margins is 3250 to 5250 ms.
  [
    "recorded WebM (Chrome, no duration in the header)",
    "recorded-chrome.webm",
    "webm",
    {
      status: "ready",
      render: { width: 320, height: 180 },
      recording: { cutMs: [3_250, 5_250] },
    },
  ],
  [
    "recorded MP4 (Safari, fragmented)",
    "recorded-safari.mp4",
    "mp4",
    {
      status: "ready",
      render: { width: 320, height: 180 },
      recording: { cutMs: [3_250, 5_250] },
    },
  ],
  [
    "normal MP4 with a pause",
    "normal.mp4",
    "mp4",
    { status: "ready", cuts: [[2_250, 3_751]], note: null, render: { width: 640, height: 360 } },
  ],
  [
    "portrait MOV, moov at the end",
    "portrait-pauses.mov",
    "mov",
    { status: "ready", cuts: [[2_249, 3_251]], render: { width: 720, height: 1280 } },
  ],
  [
    "HDR (PQ)",
    "hdr-pauses.mp4",
    "mp4",
    {
      status: "ready",
      cuts: [[2_249, 3_251]],
      render: { width: 1280, height: 720, colorTransfer: "bt709" },
    },
  ],
  [
    "pauses + A/V sync",
    "pauses-sync.mp4",
    "mp4",
    {
      status: "ready",
      cuts: [
        [0, 1_401],
        [3_250, 4_251],
        [8_250, 10_751],
        [13_250, 13_751],
        [17_600, 20_000],
      ],
      render: { width: 640, height: 360 },
      sync: true,
    },
  ],
  ["no pauses", "portrait-moov-end.mov", "mov", { status: "ready", cuts: [], note: "no_cuts" }],
  ["silent", "silent.mp4", "mp4", { status: "ready", cuts: [], note: "no_audio" }],
  [
    "too long (11 min)",
    "too-long-11min.mp4",
    "mp4",
    { status: "failed", failureCode: "too_long", messageIncludes: "11 minutes long" },
  ],
  [
    "4K",
    "4k.mp4",
    "mp4",
    { status: "failed", failureCode: "resolution_exceeded", messageIncludes: "3840×2160" },
  ],
];

export async function fixtureScenario(
  a: Creator,
  label: string,
  file: string,
  container: "mp4" | "mov" | "webm",
  want: Expect,
) {
  const takeId = await upload(
    a,
    file,
    container,
    undefined,
    want.recording ? "recording" : undefined,
  );
  const t = await waitFinal(a, takeId);
  check(label, "final status", t.take.status === want.status, t.take.status);
  if (want.failureCode) {
    check(label, "failure code", t.take.failureCode === want.failureCode, t.take.failureCode);
    check(label, "not retryable (media failure)", t.take.retryable === false, t.take.retryable);
    const [row] = await db.select().from(schema.take).where(eq(schema.take.id, takeId));
    const message = row ? uploadFailureMessage(row) : "";
    check(
      label,
      "message names the problem",
      message.includes(want.messageIncludes ?? ""),
      message,
    );
    check(label, "no job, no charge", (await jobsOf(takeId)).length === 0, "");
    return takeId;
  }

  const cuts = await cutsOf(takeId);
  if (want.recording) {
    const [from, to] = want.recording.cutMs;
    const [row] = await db.select().from(schema.take).where(eq(schema.take.id, takeId));
    check(label, "stored as a recording (AC-14)", row?.source === "recording", row?.source);
    check(
      label,
      "probe found the length (AC-4)",
      Math.abs((t.take.durationMs ?? 0) - 10_000) <= 150,
      t.take.durationMs,
    );
    check(
      label,
      "the pause is cut with its margins (one cut, 150 ms codec tolerance)",
      cuts.length === 1 &&
        cuts.every(([x, y]) => Math.abs(x - from) <= 150 && Math.abs(y - to) <= 150),
      cuts,
    );
    const steps = new Map((t.latestJob?.steps ?? []).map((s) => [s.name, s.status]));
    check(
      label,
      "probe, trim and render done",
      ["trim", "render"].every((n) => steps.get(n) === "succeeded"),
      [...steps],
    );
    // The tone has no words: with a Deepgram key the transcript step is skipped as no_speech.
    if (process.env.DEEPGRAM_API_KEY)
      check(
        label,
        "transcript step ran (no speech in a tone)",
        steps.get("transcript") === "skipped" || steps.get("transcript") === "succeeded",
        steps.get("transcript"),
      );
  } else {
    check(label, "cuts and margins", JSON.stringify(cuts) === JSON.stringify(want.cuts), cuts);
  }
  const removed = cuts.reduce((s, [x, y]) => s + (y - x), 0);
  check(label, "removedMs", Math.abs(t.removedMs - removed) <= 1, {
    api: t.removedMs,
    cuts: removed,
  });
  if (want.note !== undefined) check(label, "AC-7 note", t.note === want.note, t.note);

  const [job] = await jobsOf(takeId);
  const expectedCharge = Math.ceil((t.take.durationMs ?? 0) / 1000);
  check(
    label,
    "charge recorded",
    job?.secondsCharged === expectedCharge && job.refunded === false,
    {
      secondsCharged: job?.secondsCharged,
      expectedCharge,
      refunded: job?.refunded,
    },
  );

  if (want.render) {
    const file = await downloadRender(a, takeId);
    const f = renderFacts(file);
    check(
      label,
      "render size and orientation",
      f.width === want.render.width && f.height === want.render.height && f.rotation === 0,
      `${f.width}x${f.height} rot ${f.rotation}`,
    );
    check(
      label,
      "H.264 yuv420p + AAC",
      f.codec === "h264" && f.pixFmt === "yuv420p" && f.hasAudio,
      `${f.codec} ${f.pixFmt} audio=${f.hasAudio}`,
    );
    check(
      label,
      "CFR + faststart",
      f.cfr && f.faststart,
      `fps ${f.fps} cfr=${f.cfr} faststart=${f.faststart}`,
    );
    if (want.render.colorTransfer)
      check(
        label,
        "HDR tone mapped",
        f.colorTransfer === want.render.colorTransfer,
        f.colorTransfer,
      );
    const expectedMs = (t.take.durationMs ?? 0) - removed;
    check(
      label,
      "render length = original − removed (±1 frame)",
      Math.abs(f.durationMs - expectedMs) <= 40,
      { render: f.durationMs, expectedMs },
    );
    if (want.sync) {
      const s = avSync(file);
      check(
        label,
        "A/V sync at every cut (≤ 1 frame)",
        s.maxAbsOffsetMs <= 34 && s.offsetsMs.length === 5,
        s.offsetsMs,
      );
    }
  } else {
    check(label, "no render made", t.latestRender === null, t.latestRender);
  }
  return takeId;
}
