import { eq } from "drizzle-orm";
import { z } from "zod";
import { getTranscriptByTake } from "@/db/data/transcripts";
import type { Executor } from "@/db/types";
import { cut } from "@/db/schema";
import { sentryCheckAllowed } from "@/lib/sentry-check";

/**
 * TEMPORARY (B2-T36, removed in the B2-T36 fix PR). Reads the word list and the cut list of ONE take
 * that its owner agreed to share for the cut quality test set, so the misfiring rule can be found.
 * Read only, no model, no R2, no links. Runs only for the right token AND exactly this take ID;
 * any other take ID returns nothing. The words and cuts go in the run output (the owner's own
 * dashboard), never in a log line: logs carry counts only.
 */
export const SHARED_TAKE_ID = "9d60faec-4381-4d65-834b-4a04fd354af5";

export const payloadSchema = z.object({ token: z.string().min(1), takeId: z.string().min(1) });

export type TakeReading =
  | { readonly outcome: "skipped" }
  | { readonly outcome: "not_found" }
  | {
      readonly outcome: "read";
      /** `[index, word, startMs, endMs, filler]` per word, then the AI fixes. */
      readonly words: readonly (readonly [number, string, number, number, boolean])[];
      readonly edits: unknown;
      /** `[startMs, endMs, kind, proposedBy, applied, reason]` per cut. */
      readonly cuts: readonly (readonly [number, number, string, string, boolean, string | null])[];
    };

/** Reads the shared take's words and cuts. Pure of Trigger.dev: the database and the log are passed in. */
export async function runReadTake(
  payload: unknown,
  expectedToken: string | undefined,
  db: () => Promise<{
    readonly run: <T>(fn: (db: Executor) => Promise<T>) => Promise<T>;
  }>,
  log: (message: string, counts: Readonly<Record<string, number>>) => void,
): Promise<TakeReading> {
  const parsed = payloadSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.takeId !== SHARED_TAKE_ID ||
    !(await sentryCheckAllowed(parsed.data.token, expectedToken))
  ) {
    return { outcome: "skipped" };
  }
  const { run } = await db();
  const found = await run(async (executor) => ({
    transcript: await getTranscriptByTake(executor, SHARED_TAKE_ID),
    cuts: await executor
      .select()
      .from(cut)
      .where(eq(cut.takeId, SHARED_TAKE_ID))
      .orderBy(cut.startMs),
  }));
  if (!found.transcript) return { outcome: "not_found" };
  log("read-take: read", { words: found.transcript.words.length, cuts: found.cuts.length });
  return {
    outcome: "read",
    words: found.transcript.words.map((w, i) => [i, w.w, w.startMs, w.endMs, w.filler] as const),
    edits: found.transcript.edits,
    cuts: found.cuts.map(
      (c) => [c.startMs, c.endMs, c.kind, c.proposedBy, c.applied, c.reason] as const,
    ),
  };
}
