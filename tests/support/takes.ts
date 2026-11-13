import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./session";

/**
 * Test only: seeds takes in each state for a signed in test user, straight into the local or
 * CI Postgres (never a real database; same guard as `session.ts`). Rows go when the user is
 * deleted (foreign keys cascade).
 */

type StepSeed = {
  readonly name: "trim" | "render";
  readonly status: string;
  readonly progress?: number;
};

export type TakeSeed = {
  readonly title: string;
  readonly status: "uploading" | "uploaded" | "processing" | "ready" | "failed" | "expired";
  readonly durationMs?: number | null;
  readonly failureCode?: string | null;
  /** Days until the video expires; negative for the past. Null before upload completes. */
  readonly expiresInDays?: number | null;
  /** A job with these steps (its status follows the take). */
  readonly steps?: readonly StepSeed[];
  /** A succeeded latest render removing these ranges. */
  readonly removedRanges?: readonly { readonly startMs: number; readonly endMs: number }[];
  /** Minutes ago the take was created, for ordering. */
  readonly minutesAgo?: number;
};

const JOB_STATUS: Readonly<Record<TakeSeed["status"], string>> = {
  uploading: "queued",
  uploaded: "queued",
  processing: "running",
  ready: "succeeded",
  failed: "failed",
  expired: "succeeded",
};

export async function seedTakes(creatorId: string, seeds: readonly TakeSeed[]): Promise<string[]> {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  const ids: string[] = [];
  try {
    for (const seed of seeds) {
      const id = randomUUID();
      ids.push(id);
      const now = Date.now();
      const created = new Date(now - (seed.minutesAgo ?? 0) * 60_000);
      const expires =
        seed.expiresInDays === null
          ? null
          : new Date(now + (seed.expiresInDays ?? 30) * 24 * 60 * 60 * 1000);
      await sql`insert into take (id, creator_id, title, status, original_key, original_bytes,
                  container, duration_ms, width, height, video_expires_at, failure_code,
                  created_at, updated_at)
                values (${id}, ${creatorId}, ${seed.title}, ${seed.status},
                  ${`originals/${id}/source.mp4`}, 30754, 'mp4', ${seed.durationMs ?? null},
                  320, 180, ${expires}, ${seed.failureCode ?? null}, ${created}, ${created})`;
      if (!seed.steps) continue;
      const jobId = randomUUID();
      await sql`insert into processing_job (id, take_id, kind, status, seconds_charged, failure_code, created_at, updated_at)
                values (${jobId}, ${id}, 'initial', ${JOB_STATUS[seed.status]}, 3,
                  ${seed.status === "failed" ? (seed.failureCode ?? null) : null}, ${created}, ${created})`;
      for (const [position, step] of seed.steps.entries()) {
        await sql`insert into job_step (id, job_id, name, position, status, progress)
                  values (${randomUUID()}, ${jobId}, ${step.name}, ${position}, ${step.status}, ${step.progress ?? 0})`;
      }
      if (seed.removedRanges) {
        await sql`insert into render (id, take_id, job_id, status, video_key, duration_ms, removed_ranges, is_latest)
                  values (${randomUUID()}, ${id}, ${jobId}, 'succeeded', ${`renders/${id}/r.mp4`},
                    ${(seed.durationMs ?? 0) - seed.removedRanges.reduce((s, r) => s + r.endMs - r.startMs, 0)},
                    ${sql.json(seed.removedRanges as unknown as postgres.JSONValue)}, true)`;
      }
    }
  } finally {
    await sql.end();
  }
  return ids;
}

export type WordSeed = {
  readonly w: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly filler?: boolean;
  readonly para?: boolean;
};

/** Test only: a stored transcript (times on the original take, 25 fps) for a seeded take. */
export async function seedTranscript(
  takeId: string,
  words: readonly WordSeed[],
  edits: readonly {
    index: number;
    old: string;
    new: string;
    reason: string;
    undone: boolean;
  }[] = [],
): Promise<void> {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  try {
    const stored = words.map((word) => ({
      w: word.w,
      startMs: word.startMs,
      endMs: word.endMs,
      conf: 0.99,
      filler: word.filler ?? false,
      para: word.para ?? false,
    }));
    await sql`insert into transcript (id, take_id, language, text, words, edits, source_fps, model)
              values (${randomUUID()}, ${takeId}, 'en', ${words.map((w) => w.w).join(" ")},
                ${sql.json(stored as unknown as postgres.JSONValue)},
                ${sql.json(edits as unknown as postgres.JSONValue)}, 25, 'nova-3')`;
  } finally {
    await sql.end();
  }
}

/** Test only: a new latest render for a take (as a re render would make), so the version changes. */
export async function replaceLatestRender(takeId: string): Promise<void> {
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  try {
    const [old] = await sql`select job_id, duration_ms, removed_ranges from render
                            where take_id = ${takeId} and is_latest`;
    if (!old) throw new Error("take has no latest render");
    const id = randomUUID();
    await sql`update render set is_latest = false where take_id = ${takeId}`;
    await sql`insert into render (id, take_id, job_id, status, video_key, duration_ms, removed_ranges, is_latest)
              values (${id}, ${takeId}, ${old.job_id}, 'succeeded', ${`renders/${takeId}/${id}.mp4`},
                ${old.duration_ms}, ${sql.json(old.removed_ranges)}, true)`;
  } finally {
    await sql.end();
  }
}
