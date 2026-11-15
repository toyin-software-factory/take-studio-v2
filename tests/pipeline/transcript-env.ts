/** What the transcript scenarios share (spec 0007): the run context, the transcript view and helpers. */
import { spawnSync } from "node:child_process";
import { asc, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { db } from "./harness";
import { type Creator } from "./creator";

export type TakeLike = {
  take: { status: string; expired?: boolean };
  latestRender: { id: string; durationMs: number | null } | null;
};

export type Ctx = {
  /** The creator of the earlier fixtures (the no audio take is theirs). */
  readonly a: Creator;
  /** A fresh creator for the transcript takes: the upload limit is 10 per hour per creator. */
  readonly t: Creator;
  readonly b: Creator;
  readonly check: (scenario: string, name: string, ok: boolean, detail?: unknown) => void;
  readonly upload: (creator: Creator, file: string, container: "mp4" | "mov") => Promise<string>;
  readonly waitFinal: (creator: Creator, takeId: string) => Promise<TakeLike>;
  readonly downloadRender: (creator: Creator, takeId: string) => Promise<string>;
  readonly media: (file: string) => string;
  /** The take ID of the existing "silent" fixture (a video with no audio stream), if it ran. */
  readonly noAudioTakeId: string | undefined;
};

export type View = {
  state: string;
  reason?: string;
  canMake: boolean;
  version?: string;
  paragraphs?: {
    startMs: number;
    words: { w: string; startMs: number; endMs: number; filler: boolean }[];
  }[];
};

export const FRAME_MS = 1000 / 30;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function view(c: Creator, takeId: string): Promise<View & { status: number }> {
  const res = await c.api("GET", `/api/takes/${takeId}/transcript`);
  return { status: res.status, ...(res.json as unknown as View) };
}

/** Polls the transcript every 2 s until it is no longer none or making. */
export async function waitTranscript(
  c: Creator,
  takeId: string,
): Promise<View & { status: number }> {
  let last = await view(c, takeId);
  for (let i = 0; i < 90 && (last.state === "none" || last.state === "making"); i++) {
    await sleep(2_000);
    last = await view(c, takeId);
  }
  return last;
}

/** `silence_end` times (s) of the audio: when each stretch of sound begins. */
export function onsets(path: string): number[] {
  const log = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      path,
      "-vn",
      "-af",
      "silencedetect=noise=-35dB:d=0.3",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 64 << 20 },
  ).stderr;
  return [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
}

/** Cue start times (ms) of an SRT file. */
export function srtStarts(srt: string): number[] {
  return [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> /g)].map(
    (m) => ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]),
  );
}

export const jobsOf = (takeId: string) =>
  db
    .select()
    .from(schema.processingJob)
    .where(eq(schema.processingJob.takeId, takeId))
    .orderBy(asc(schema.processingJob.createdAt));

export const rowsOf = (takeId: string) =>
  db.select().from(schema.transcript).where(eq(schema.transcript.takeId, takeId));
