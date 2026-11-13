/** Polling helpers shared by the pipeline scenarios. */
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { db } from "./harness";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits (polling every 2 s) until `done` says so; null on timeout. */
export async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, seconds: number) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > end) return null;
    await sleep(2_000);
  }
}

/** Waits (up to 4 minutes) until the take has no queued or running job of any kind. */
export async function waitIdle(takeId: string): Promise<void> {
  const idle = await until(
    () => db.select().from(schema.processingJob).where(eq(schema.processingJob.takeId, takeId)),
    (jobs) => jobs.every((j) => !["queued", "running"].includes(j.status)),
    240,
  );
  if (!idle) throw new Error("the take still has a running job after 4 minutes");
}
