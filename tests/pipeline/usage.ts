/**
 * Monthly usage limit checks for the pipeline run (spec 0014 step 7): two uploads against a
 * small allowance. The first fits and is charged; the second is refused at the probe and kept
 * (AC-6); the early refusal and `GET /api/usage` agree (AC-7, AC-8); after the allowance setting
 * is raised, Retry runs it and charges it (AC-4). Real R2 and Trigger.dev dev. The two settings
 * are global to the local database, so they are restored at the end.
 */
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { type Creator, db } from "./harness";
import { until } from "./wait";

export type Ctx = {
  readonly c: Creator;
  readonly check: (scenario: string, name: string, ok: boolean, detail?: unknown) => void;
  readonly upload: (creator: Creator, file: string, container: "mp4" | "mov") => Promise<string>;
  readonly waitFinal: (creator: Creator, takeId: string) => Promise<unknown>;
};

const S = "usage limit";
const FILE = "normal.mp4";

type Numbers = {
  usedSeconds: number;
  allowanceSeconds: number;
  remainingSeconds: number;
  resetsOn: string;
};
type TakeJson = {
  take: {
    status: string;
    failureCode: string | null;
    retryable: boolean;
    durationMs: number | null;
  };
  latestJob: unknown;
};

async function setSettings(enabled: boolean, seconds: number): Promise<void> {
  for (const row of [
    { key: "usage_limit_enabled", value: enabled },
    { key: "free_monthly_seconds", value: seconds },
  ]) {
    await db
      .insert(schema.appSetting)
      .values(row)
      .onConflictDoUpdate({ target: schema.appSetting.key, set: { value: row.value } });
  }
}

export async function usageScenarios(ctx: Ctx): Promise<void> {
  const { c, check } = ctx;
  const usage = async () => {
    const res = await c.raw("GET", "/api/usage");
    return {
      status: res.status,
      cache: res.headers.get("cache-control"),
      body: JSON.parse(res.text) as Numbers,
      text: res.text,
    };
  };
  const takeOf = async (id: string) =>
    (await c.api("GET", `/api/takes/${id}`)).json as unknown as TakeJson;
  const jobsOf = (takeId: string) =>
    db.select().from(schema.processingJob).where(eq(schema.processingJob.takeId, takeId));

  try {
    await setSettings(true, 3600);
    const first = await ctx.upload(c, FILE, "mp4");
    await ctx.waitFinal(c, first);
    const firstTake = await takeOf(first);
    const seconds = Math.ceil((firstTake.take.durationMs ?? 0) / 1000);
    check(S, "the first take is ready and charged its seconds", seconds > 1, { seconds });
    const afterFirst = await usage();
    check(
      S,
      "GET /api/usage shows the charge, private and no-store",
      afterFirst.status === 200 &&
        afterFirst.cache === "private, no-store" &&
        afterFirst.body.usedSeconds === seconds,
      afterFirst.body,
    );
    check(
      S,
      "the usage body has no email or hash",
      !/@|account|hash/i.test(afterFirst.text),
      afterFirst.text,
    );

    // Room for half of the second take only.
    const allowance = seconds + Math.floor(seconds / 2);
    await setSettings(true, allowance);
    const left = allowance - seconds;
    const hinted = await c.api("POST", "/api/uploads", {
      fileName: FILE,
      sizeBytes: 1000,
      container: "mp4",
      durationHintMs: (left + 5) * 1000,
    });
    check(
      S,
      "early refusal: a hint longer than what is left gives 403 limit_exceeded with the numbers",
      hinted.status === 403 &&
        hinted.json.error === "limit_exceeded" &&
        hinted.json.remainingSeconds === left,
      hinted.json,
    );

    // No hint: the upload is accepted, and the probe refuses it (AC-6).
    const second = await ctx.upload(c, FILE, "mp4");
    const refusedOrNull = await until(
      () => takeOf(second),
      (t) => t.take.status === "failed" || t.take.status === "ready",
      180,
    );
    if (!refusedOrNull) throw new Error("the second take did not finish probing in 3 minutes");
    const refused = refusedOrNull;
    check(
      S,
      "the second take failed with limit_exceeded, retryable, no job",
      refused.take.status === "failed" &&
        refused.take.failureCode === "limit_exceeded" &&
        refused.take.retryable &&
        (await jobsOf(second)).length === 0,
      refused.take,
    );
    const kept = await c.api("GET", `/api/takes/${second}/media?kind=original`);
    check(S, "the original is kept (a media link is served)", kept.status === 200, kept.status);
    const afterRefusal = await usage();
    check(
      S,
      "nothing was charged for the refused take",
      afterRefusal.body.usedSeconds === seconds,
      afterRefusal.body,
    );

    const early = await c.api("POST", `/api/takes/${second}/retry`);
    check(
      S,
      "retry before the reset or a raise: 403 with the dated message and the four numbers",
      early.status === 403 &&
        early.json.error === "limit_exceeded" &&
        typeof early.json.message === "string" &&
        /\d/.test(String(early.json.message)) &&
        early.json.usedSeconds === seconds &&
        early.json.allowanceSeconds === allowance,
      early.json,
    );

    // Raise the setting, retry: it runs and is charged (AC-4).
    await setSettings(true, 3600);
    const retried = await c.api("POST", `/api/takes/${second}/retry`);
    check(S, "retry after the setting is raised is accepted", retried.status === 202, retried.json);
    await ctx.waitFinal(c, second);
    const done = await takeOf(second);
    const final = await usage();
    check(
      S,
      "the retried take is ready and charged once",
      done.take.status === "ready" && final.body.usedSeconds === seconds * 2,
      { take: done.take.status, used: final.body.usedSeconds },
    );
  } finally {
    await setSettings(false, 3600);
  }
}
