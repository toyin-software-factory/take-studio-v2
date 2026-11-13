/**
 * Time and cost measurement for the transcript and AI edit steps (spec 0012 build step 8,
 * AC-6 and AC-9). `PIPELINE_ONLY=ai pnpm test:pipeline` runs it with the real Deepgram and the
 * real Claude (needs DEEPGRAM_API_KEY and ANTHROPIC_API_KEY in the shell, and LIVE_SLICE 5).
 *
 * The long take is built here, never committed: the synthetic English clip `speech-en.mp4`
 * (Deepgram text to speech, no real person) repeated to just under 10 minutes. The text repeats,
 * so the word count is realistic (about 150 words a minute) but the content is not; say so
 * when reporting. Numbers only are printed: no transcript, reason or answer text.
 *
 * Per run: seconds from the transcript step's start to the ai_edit step's end (AC-6 says at
 * most 120), each step's own seconds, and the input and output tokens that `ai-edit-step.ts`
 * logs ("ai edit answered") in trigger.log. Cost needs the model's prices per million tokens in
 * AI_PRICE_IN_PER_MTOK and AI_PRICE_OUT_PER_MTOK (USD): they are not guessed here.
 * AI_RUNS (default 3) sets how many 10 minute takes are made, for p50 and the worst case.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { type Creator, db, work } from "./harness";

const MAX_SECONDS = 120; // AC-6
const MAX_TAKE_SECONDS = 600; // a take is at most 10 minutes

export type AiMeasureCtx = {
  readonly c: Creator;
  readonly check: (scenario: string, name: string, ok: boolean, detail?: unknown) => void;
  readonly upload: (creator: Creator, file: string, container: "mp4" | "mov") => Promise<string>;
  readonly waitFinal: (
    creator: Creator,
    takeId: string,
  ) => Promise<{ take: { status: string }; aiEdit?: string | null }>;
  /** Absolute path of a fixture. */
  readonly media: (file: string) => string;
};

export type Sample = {
  readonly label: string;
  readonly addedSeconds: number | null;
  readonly transcriptSeconds: number | null;
  readonly aiEditSeconds: number | null;
  readonly aiEditStatus: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
};

/** Pure: p50 (lower median) and max of a list. */
export function summarise(values: readonly number[]): { p50: number; worst: number } | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  return { p50: s[Math.floor((s.length - 1) / 2)] ?? 0, worst: s[s.length - 1] ?? 0 };
}

/** Pure: USD for one call at the given prices per million tokens. */
export function costUsd(
  inputTokens: number,
  outputTokens: number,
  priceInPerMtok: number,
  priceOutPerMtok: number,
): number {
  return (inputTokens * priceInPerMtok + outputTokens * priceOutPerMtok) / 1_000_000;
}

/** Pure: the token counts logged for one job in trigger.log (null when the line is missing). */
export function tokensFromLog(
  log: string,
  jobId: string,
): { inputTokens: number; outputTokens: number } | null {
  for (const line of log.split("\n")) {
    if (!line.includes("ai edit answered") || !line.includes(jobId)) continue;
    const input = /inputTokens\D+(\d+)/.exec(line)?.[1];
    const output = /outputTokens\D+(\d+)/.exec(line)?.[1];
    if (input !== undefined && output !== undefined)
      return { inputTokens: Number(input), outputTokens: Number(output) };
  }
  return null;
}

const seconds = (from: Date | null | undefined, to: Date | null | undefined) =>
  from && to ? (to.getTime() - from.getTime()) / 1000 : null;

/** Builds the long fixture by repeating the short clip (stream copy, a second or two). */
function buildLongFixture(shortClip: string, clipSeconds: number): string {
  const repeats = Math.floor(MAX_TAKE_SECONDS / clipSeconds);
  const list = join(work, "long-list.txt");
  writeFileSync(list, Array.from({ length: repeats }, () => `file '${shortClip}'`).join("\n"));
  const out = join(work, "speech-10min.mp4");
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0"].concat([
      "-i",
      list,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      out,
    ]),
  );
  return out;
}

async function measure(ctx: AiMeasureCtx, label: string, takeId: string): Promise<Sample> {
  const [job] = await db
    .select()
    .from(schema.processingJob)
    .where(eq(schema.processingJob.takeId, takeId));
  const steps = job
    ? await db.select().from(schema.jobStep).where(eq(schema.jobStep.jobId, job.id))
    : [];
  const tr = steps.find((s) => s.name === "transcript");
  const ai = steps.find((s) => s.name === "ai_edit");
  const logPath = join(work, "trigger.log");
  const tokens =
    job && existsSync(logPath) ? tokensFromLog(readFileSync(logPath, "utf8"), job.id) : null;
  return {
    label,
    addedSeconds: seconds(tr?.startedAt, ai?.finishedAt),
    transcriptSeconds: seconds(tr?.startedAt, tr?.finishedAt),
    aiEditSeconds: seconds(ai?.startedAt, ai?.finishedAt),
    aiEditStatus: ai?.status ?? null,
    inputTokens: tokens?.inputTokens ?? null,
    outputTokens: tokens?.outputTokens ?? null,
  };
}

export async function aiEditMeasure(ctx: AiMeasureCtx): Promise<void> {
  const S = "ai edit";
  const runs = Math.max(1, Number(process.env.AI_RUNS ?? 3));
  const priceIn = Number(process.env.AI_PRICE_IN_PER_MTOK);
  const priceOut = Number(process.env.AI_PRICE_OUT_PER_MTOK);
  const priced = Number.isFinite(priceIn) && Number.isFinite(priceOut);

  const short = ctx.media("speech-en.mp4");
  const clipSeconds = Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      short,
    ])
      .toString()
      .trim(),
  );
  const long = buildLongFixture(short, clipSeconds);

  const samples: Sample[] = [];
  const shortId = await ctx.upload(ctx.c, "speech-en.mp4", "mp4");
  const shortTake = await ctx.waitFinal(ctx.c, shortId);
  ctx.check(S, "short take Ready", shortTake.take.status === "ready", shortTake.take.status);
  samples.push(await measure(ctx, "short", shortId));

  for (let i = 1; i <= runs; i++) {
    const id = await ctx.upload(ctx.c, long, "mp4");
    const t = await ctx.waitFinal(ctx.c, id);
    ctx.check(S, `10 min take ${i} Ready`, t.take.status === "ready", t.take.status);
    samples.push(await measure(ctx, `10min-${i}`, id));
  }

  for (const s of samples) {
    const cost =
      priced && s.inputTokens !== null && s.outputTokens !== null
        ? costUsd(s.inputTokens, s.outputTokens, priceIn, priceOut)
        : null;
    console.log(`[ai-measure] ${JSON.stringify({ ...s, costUsd: cost })}`);
    if (s.label !== "short") {
      ctx.check(
        S,
        `AC-6 ${s.label}: transcript plus AI added ≤ ${MAX_SECONDS} s`,
        s.addedSeconds !== null && s.addedSeconds <= MAX_SECONDS,
        s,
      );
      ctx.check(S, `AC-9 ${s.label}: token counts logged`, s.inputTokens !== null, s);
    }
  }
  const longOnes = samples.filter((s) => s.label !== "short");
  const added = summarise(
    longOnes.flatMap((s) => (s.addedSeconds === null ? [] : [s.addedSeconds])),
  );
  console.log(`[ai-measure] 10 min added seconds p50/worst: ${JSON.stringify(added)}`);
  if (!priced)
    console.log("[ai-measure] set AI_PRICE_IN_PER_MTOK and AI_PRICE_OUT_PER_MTOK for cost");
}
